import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createEngineeringTools} from './ceo.ts';
import {WorkerPreflight} from './workerPreflight.ts';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('checks current session authority on every engineering discovery dispatch',async()=>{
 let denied:string|null='session revoked';const broker=vi.fn(async(input:unknown)=>({input}));
 const tools=createEngineeringTools(()=>'',undefined,()=>denied,undefined,broker);
 expect(JSON.parse(await tools.call('platform_discovery',{request_json:'{"kind":"identity"}'})).isError).toBe(true);
 expect(broker).not.toHaveBeenCalled();denied=null;
 await tools.call('platform_discovery',{request_json:'{"kind":"identity"}'});
 expect(broker).toHaveBeenCalledExactlyOnceWith({kind:'identity'});
 denied='session ended';await tools.call('platform_discovery',{request_json:'{"kind":"environments"}'});
 expect(broker).toHaveBeenCalledTimes(1);
});
it('refuses ambiguous duplicate JSON before calling the scoped broker',async()=>{
 const broker=vi.fn();const tools=createEngineeringTools(()=>'',undefined,()=>null,undefined,broker);
 await expect(tools.call('platform_discovery',{request_json:'{"kind":"identity","kind":"environments"}'})).rejects.toThrow();
 expect(broker).not.toHaveBeenCalled();
});
it('dispatches the advertised verified-list schema request unchanged and keeps session revocation effective',async()=>{
 const broker=vi.fn(async()=>({scope:'native-sharepoint-list-schema',limits:['Metadata only']}));let revoked=false;
 const tools=createEngineeringTools(()=>'',undefined,()=>revoked?'Session ended':null,undefined,broker);
 const input={kind:'sharepoint-list-schema',resourceKey:'probe_requests'};
 const result=JSON.parse(await tools.call('platform_discovery',{request_json:JSON.stringify(input)}));
 expect(result.isError).not.toBe(true);expect(broker).toHaveBeenCalledExactlyOnceWith(input);
 revoked=true;expect(JSON.parse(await tools.call('platform_discovery',{request_json:JSON.stringify(input)})).isError).toBe(true);
 expect(broker).toHaveBeenCalledTimes(1);
});
it.each(['discovery','design'] as const)('permits only the named scoped metadata broker in %s sessions',mode=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'discovery-wiring-'));roots.push(root);
 const gate=new WorkerPreflight(root,()=>({fingerprint:'empty',warnings:[],skills:[]}),()=>1000,'codex',mode);
 expect(gate.before('metadata','mcp__office__platform_discovery',{request_json:'{"kind":"identity"}'})).toBeNull();
 gate.after('metadata',{arbitrary:'metadata result'},false);
 for(const name of ['exec_command','Edit','mcp__swarm_flowagent__invoke_operation','mcp__swarm_flowagent__get_operation_details','mcp__office__platform_discovery_extra','mcp__office__canvas_authoring_acquire','mcp__office__approve_release']){
  expect(gate.before(name,name,{})).toContain('Read-only discovery');
 }
 expect(gate.observed().ready).toBe(false);
});
