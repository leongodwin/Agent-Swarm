import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {verifyCanvasSourceSync} from '../server/canvasSourceSync.ts';
import {flowCleanup} from '../server/flowCleanup.ts';
import {flowAdapterEnvironment} from '../server/flowEnvironment.ts';

const {values}=parseArgs({options:{live:{type:'boolean'},'studio-url':{type:'string'},'environment-id':{type:'string'},'app-id':{type:'string'},account:{type:'string'},server:{type:'string'},'output-root':{type:'string'}},strict:true});
if(!values.live)throw new Error('Explicit --live and an approved saved-app Studio target are required');
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
const nativeCalls:{tool:string;contentTypes:string[];isError:boolean;textBytes:number}[]=[];
const interrupt=()=>controller.abort();process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try{
 const result=await verifyCanvasSourceSync({studioUrl:values['studio-url'],environmentId:values['environment-id'],appId:values['app-id'],account:values.account},values['output-root']??'',controller.signal,async signal=>{
  const executable=values.server;if(!executable||!path.isAbsolute(executable)||(await fs.lstat(executable)).isSymbolicLink()||!(await fs.stat(executable)).isFile())throw new Error('Provide the approved installed Canvas Authoring MCP executable');
  const transport=new StdioClientTransport({command:executable,args:[],stderr:'ignore',env:flowAdapterEnvironment()}),client=new Client({name:'cubefarm-canvas-source-diagnostic',version:'1'}),cleanup=flowCleanup(client,transport);
  const abort=()=>{void cleanup.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  const close=async()=>{signal.removeEventListener('abort',abort);await cleanup.close();};
  try{
   signal.throwIfAborted();cleanup.started();await client.connect(transport,{timeout:15000});signal.throwIfAborted();cleanup.assertOpen();
   const names=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined;
   for(let page=0;page<20;page++){const list=await client.listTools({cursor},{signal,timeout:15000});signal.throwIfAborted();cleanup.assertOpen();list.tools.forEach(t=>names.add(t.name));cursor=list.nextCursor;if(!cursor)break;if(cursors.has(cursor))throw new Error('Repeated MCP tool cursor');cursors.add(cursor);}
   if(cursor||['connect','list_accounts','sync_canvas'].some(name=>!names.has(name)))throw new Error('Native Canvas tool contract unavailable');
   return {close,async call(tool,input,signal){if(!['connect','list_accounts','sync_canvas'].includes(tool))throw new Error('Read-only diagnostic tool denied');signal.throwIfAborted();cleanup.assertOpen();const result=await client.callTool({name:tool,arguments:input},undefined,{signal,timeout:30000});nativeCalls.push({tool,contentTypes:Array.isArray(result.content)?result.content.map(c=>String(c.type)):[],isError:result.isError===true,textBytes:Array.isArray(result.content)?result.content.reduce((n,c)=>n+(c.type==='text'&&typeof c.text==='string'?Buffer.byteLength(c.text):0),0):0});signal.throwIfAborted();cleanup.assertOpen();return result;}};
  }catch(error){await close();throw error;}
 });
 console.log(JSON.stringify({...result,nativeCalls},null,2));if(result.status!=='source-sync-observed')process.exitCode=2;
}catch{console.log(JSON.stringify({status:'blocked',stage:'saved-app-target-or-output-validation',sourceSyncObserved:false,authoringApproved:false,remedy:'Supply the exact approved saved-app edit URL, matching environment/app IDs and account, an existing canonical output root, and installed native server. No experimental new-app fallback is permitted.'}));process.exitCode=2;}
finally{clearTimeout(timer);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
