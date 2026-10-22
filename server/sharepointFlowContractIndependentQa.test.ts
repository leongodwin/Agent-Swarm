import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {WorkerPreflight} from './workerPreflight.ts';
import {sharepointPlan,sharepointHash} from './sharepointProvisioning.ts';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sp-hook-independent-'));roots.push(root);let now=100000;
 const guid='11111111-1111-4111-8111-111111111111',api='/providers/Microsoft.PowerApps/apis/shared_sharepointonline';
 const plan=sharepointPlan.parse({schemaVersion:1,tenantId:guid,username:'maker@example.test',siteUrl:'https://synthetic.sharepoint.com/sites/Probe',siteCollectionId:guid,webId:guid,resources:[{key:'probe_requests',displayName:'Probe',template:'genericList',columns:[]}]});
 fs.writeFileSync(path.join(root,'cubefarm.sharepoint.json'),JSON.stringify(plan));fs.mkdirSync(path.join(root,'.cubefarm'));
 const probe={tool:'mcp__test__identity',input:{},id:'identity',readOnly:true,assertions:[{kind:'identity',pointer:['actor'],equals:'maker'},{kind:'target',pointer:['env'],equals:'env'}]};
 fs.writeFileSync(path.join(root,'.cubefarm/worker-preflight.json'),JSON.stringify({schemaVersion:1,scope:'Synthetic hook correlation only',mode:'authoring',maxAgeSeconds:600,skills:[],noSkillsReason:'Synthetic test has no platform guidance',probes:[probe]}));
 const gate=new WorkerPreflight(root,()=>({fingerprint:'synthetic',skills:[],warnings:[]}),()=>now,'codex','authoring',undefined,'owner/probe');
 expect(gate.before('probe',probe.tool,{})).toBeNull();gate.after('probe',{actor:'maker',env:'env'},false);
 const request={request_json:JSON.stringify({kind:'sharepoint-list-schema',resourceKey:'probe_requests'})};
 const receipt:any={scope:'read-only-platform-metadata',request:JSON.parse(request.request_json),observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString(),binding:{tenantId:guid,username:plan.username,environmentId:'env'},data:{scope:'native-sharepoint-list-schema',repoId:'owner/probe',resourceKey:'probe_requests',planSha256:sharepointHash(plan),siteUrl:plan.siteUrl,listId:guid,connectionId:'approved',environmentId:'env',tenantId:guid,username:plan.username,metadata:{name:guid,schema:{items:{required:['Title','AttemptCount'],properties:{Title:{type:'string','x-ms-permission':'read-write'},AttemptCount:{type:'number','x-ms-permission':'read-write'}}}}}}};
 const raw=()=>({content:[{type:'text',text:JSON.stringify({observation:receipt,evidence:{sha256:'a'.repeat(64)}})}]});
 const item:any={Title:"@body('Read_current')?['Title']",AttemptCount:0};
 const create:any={env:'env',definition:{actions:{Scope:{type:'Scope',actions:{Update:{type:'OpenApiConnection',inputs:{host:{apiId:api,operationId:'PatchItem',connectionName:'sp'},parameters:{dataset:plan.siteUrl,table:guid,id:1,item}}}}}}},connectionRefs:{sp:{id:api,connectionName:'approved'}}};
 const capture=(id='schema')=>{expect(gate.before(id,'mcp__office__platform_discovery',request)).toBeNull();gate.after(id,raw(),false);};
 return{root,gate,request,receipt,raw,item,create,capture,advance:()=>{now+=60000;}};
}
it.each(['unmatched','cancelled','wrong-name','wrong-resource','error-result'])('does not establish schema from %s hook result',mode=>{
 const f=fixture();
 if(mode!=='unmatched')expect(f.gate.before('schema','mcp__office__platform_discovery',f.request)).toBeNull();
 if(mode==='cancelled')f.gate.cancel('schema');if(mode==='wrong-resource')f.receipt.request.resourceKey='foreign';
 f.gate.after('schema',mode==='error-result'?{...f.raw(),isError:true}:f.raw(),false,mode==='wrong-name'?'mcp__foreign__platform_discovery':undefined);
 expect(f.gate.before('create','mcp__flowagent__create_flow',f.create)).toContain('fresh exact-target');
});
it('requires correlated fresh schema and preserves zero values without claiming content semantics',()=>{
 const f=fixture();expect(f.gate.before('missing','mcp__flowagent__create_flow',f.create)).toContain('fresh exact-target');f.capture();
 const before=JSON.stringify(f.create);expect(f.gate.before('valid','mcp__flowagent__create_flow',f.create)).toBeNull();expect(JSON.stringify(f.create)).toBe(before);f.gate.cancel('valid');
 delete f.item.Title;expect(f.gate.before('sparse','mcp__flowagent__create_flow',f.create)).toContain('missing required item/Title');
});
it.each(['failed','wrong-name','error-result'])('revokes previously valid schema on a %s refresh',mode=>{
 const f=fixture();f.capture();expect(f.gate.before('refresh','mcp__office__platform_discovery',f.request)).toBeNull();
 f.gate.after('refresh',mode==='error-result'?{...f.raw(),isError:true}:f.raw(),mode==='failed',mode==='wrong-name'?'wrong_tool':undefined);
 expect(f.gate.before('create','mcp__flowagent__create_flow',f.create)).toContain('fresh exact-target');
});
it('expires schema independently of still-current native identity probes',()=>{
 const f=fixture();f.capture();f.advance();expect(f.gate.blocker()).toBeNull();expect(f.gate.before('create','mcp__flowagent__create_flow',f.create)).toContain('fresh exact-target');
});
it.each(['mcp_flowagent_create_flow','mcp_swarm_flowagent_create_flow'])('enforces the conservative check for Gemini native alias %s',name=>{
 const f=fixture();f.capture();delete f.item.Title;
 expect(f.gate.before('create',name,f.create)).toContain('missing required item/Title');
});
