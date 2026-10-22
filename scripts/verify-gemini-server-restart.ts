import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hostSocket,PTY_PROTOCOL,encode,readMessages,type FromHost} from '../server/ptyProtocol.ts';
import {parseUnambiguousJson} from '../server/unambiguousJson.ts';
import {serverRestartPassed,classifyRestartUserMessages,type RestartProof} from './serverRestartChecks.ts';
if(!process.argv.includes('--live'))throw new Error('Requires explicit --live: authenticated synthetic server restart');
const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cubefarm-restart-live-'));
const proof:RestartProof={};let error:string|undefined;
async function stopKeeper(){
 const home=path.join(root,'office');if(!fs.existsSync(path.join(home,'pty.secret')))return;
 await new Promise<void>((resolve,reject)=>{const socket=net.createConnection(hostSocket(home));const timer=setTimeout(()=>{socket.destroy();reject(new Error('Isolated keeper shutdown timed out'));},6000);
 socket.once('error',reject);socket.once('connect',()=>socket.write(encode({op:'hello',version:PTY_PROTOCOL,secret:fs.readFileSync(path.join(home,'pty.secret'),'utf8').trim()})));
 readMessages<FromHost>(socket,message=>{if(message.op!=='ready')return;if(message.ptys.some(row=>row.exit===null)||proof.before?.keeperInstance&&message.instance!==proof.before.keeperInstance){clearTimeout(timer);socket.destroy();reject(new Error('Keeper still owns active or unexpected native work'));return;}socket.write(encode({op:'shutdown'}));});
 socket.once('close',()=>{clearTimeout(timer);resolve();});
 });
 if(proof.before?.keeperPid){for(let i=0;i<80;i++){try{process.kill(proof.before.keeperPid,0);}catch{return;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Keeper process exit remains unverified');}
}
try{
 for(const stage of ['before','after']){
  const result=await promisify(execFile)(process.execPath,['--import','tsx','scripts/geminiRestartServer.ts',root,stage,'--live'],{windowsHide:true,timeout:105000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(root,stage+'.log'),result.stdout+result.stderr);
  if(stage==='before'){proof.beforeExited=true;proof.before=JSON.parse(fs.readFileSync(path.join(root,'handoff.json'),'utf8'));}else{proof.afterExited=true;proof.after=JSON.parse(fs.readFileSync(path.join(root,'adopted.json'),'utf8'));}
 }
 const handoff=JSON.parse(fs.readFileSync(path.join(root,'handoff.json'),'utf8'));const transcript=handoff.hooks.findLast((row:Record<string,unknown>)=>row.event==='UserPromptSubmit')?.transcriptPath;
 if(typeof transcript!=='string')throw new Error('Owning transcript missing');const stat=fs.lstatSync(transcript);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new Error('Unsafe owning transcript');
 const bytes=fs.readFileSync(transcript);const rows=bytes.toString('utf8').trimEnd().split('\n').map(line=>parseUnambiguousJson(line) as Record<string,any>);
 const responses=rows.filter(row=>row.type==='gemini');const content=responses.at(-1)?.content;proof.native={sessionId:rows[0].sessionId,projectHashMatches:rows[0].projectHash===crypto.createHash('sha256').update(path.join(root,'synthetic')).digest('hex'),...classifyRestartUserMessages(rows),marker:typeof content==='string'&&content.trim()==='CUBEFARM_RESTART_OK'?content.trim():undefined};
 fs.writeFileSync(path.join(root,'native-receipts.json'),JSON.stringify({file:path.basename(transcript),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sessionId:rows[0].sessionId,records:responses.map(row=>({id:row.id,timestamp:row.timestamp,tokens:row.tokens}))},null,2));
}catch(caught){error=caught instanceof Error?caught.message:String(caught);try{await promisify(execFile)(process.execPath,['--import','tsx','scripts/geminiRestartServer.ts',root,'cleanup','--live'],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});}catch{error+='; isolated native cleanup remains unverified';}}
finally{try{await stopKeeper();proof.keeperStopped=true;}catch(caught){error??=caught instanceof Error?caught.message:String(caught);}}
const report={root,scope:'two actual isolated runtime HTTP server processes with authenticated native Gemini',proof,error,passed:serverRestartPassed(proof)};
fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/gemini-server-restart-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify({root,passed:report.passed,error}));process.exitCode=report.passed?0:1;
