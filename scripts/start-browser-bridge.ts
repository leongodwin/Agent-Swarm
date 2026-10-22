import path from 'node:path';
import {createRequire} from 'node:module';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startBrowserBridge} from '../server/browserBridge.ts';
const require=createRequire(import.meta.url),cli=path.join(path.dirname(require.resolve('@playwright/mcp/package.json')),'cli.js');
// Native Edge profile directory name, not a copied profile or user-data path.
const profile=process.argv[3];
if(profile&&!/^(?:Default|Profile [1-9]\d*)$/.test(profile))throw Error('Invalid native browser profile directory name');
const client=new Client({name:'CubeFarm-approved-pipeline-browser',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'--extension','--browser','msedge',...(profile?['--profile-dir-name',profile]:[])],stderr:'ignore'}),{timeout:15000});
const bridge=await startBrowserBridge({listTools:()=>client.listTools(),callTool:(input,signal)=>client.callTool(input,undefined,{signal,timeout:120000}) as ReturnType<Parameters<typeof startBrowserBridge>[0]['callTool']>,close:()=>client.close()},Number(process.argv[2]??62141));
console.log(JSON.stringify({scope:'loopback-approved-browser-bridge',endpoint:bridge.endpoint,pid:process.pid}));
let closing=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(!closing){closing=true;void bridge.close().finally(()=>process.exit());}});
