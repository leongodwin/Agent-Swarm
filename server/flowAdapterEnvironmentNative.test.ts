import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {expect,it,vi} from 'vitest';
vi.mock('./skillRegistry.ts',()=>({discoverSkills:()=>({skills:[]})}));
import {connectFlowAdapter} from './flowAdapter.ts';
it('launches an owned real MCP stdio fixture without unrelated credentials or Node preload injection',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-flow-env-mcp-')),entry=path.join(root,'fixture.mjs');
  const source=`import {createInterface} from 'node:readline';
const tools=['whoami','get_flow','get_flow_context','preflight_flow','publish_flow','disable_flow','get_run_history','get_run_details','get_run_actions','get_run_action_content'];
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{const req=JSON.parse(line);if(req.id===undefined)return;let result;
if(req.method==='initialize')result={protocolVersion:req.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned-env-fixture',version:'1'}};
else if(req.method==='tools/list')result={tools:tools.map(name=>({name,inputSchema:{type:'object',properties:{}}}))};
else if(req.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({credentialPresent:process.env.GH_TOKEN!==undefined,preloadPresent:process.env.NODE_OPTIONS!==undefined,profile:process.env.AZURE_CONFIG_DIR,cache:process.env.FLOWAGENT_MSAL_CACHE_DIR})}]};
else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Unsupported fixture method'}})+'\\n');return;}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');});
lines.on('close',()=>process.exit(0));`;
  await fs.writeFile(entry,source);vi.stubEnv('SWARM_FLOWAGENT_ENTRY',entry);vi.stubEnv('GH_TOKEN','synthetic-private-canary');vi.stubEnv('NODE_OPTIONS','--require synthetic-private-preload');vi.stubEnv('AZURE_CONFIG_DIR','synthetic-existing-profile');vi.stubEnv('FLOWAGENT_MSAL_CACHE_DIR','synthetic-existing-cache');
  let adapter:Awaited<ReturnType<typeof connectFlowAdapter>>|undefined;
  try{adapter=await connectFlowAdapter(root,new AbortController().signal);expect(await adapter.call('whoami',{})).toEqual({credentialPresent:false,preloadPresent:false,profile:'synthetic-existing-profile',cache:'synthetic-existing-cache'});await adapter.close();await expect(adapter.call('whoami',{})).rejects.toThrow('closed');}
  finally{await adapter?.close();vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
