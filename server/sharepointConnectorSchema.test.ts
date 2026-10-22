import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {sharepointConnectorSchema} from './sharepointConnectorSchema.ts';
import {sharepointHash,sharepointPlan} from './sharepointProvisioning.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const id='11111111-1111-4111-8111-111111111111',repo='owner/probe',identity={tenantId:id,username:'qa@example.test',environmentId:id};
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'connector-schema-'));roots.push(root);
 const plan={schemaVersion:1,tenantId:id,username:identity.username,siteUrl:'https://synthetic.sharepoint.com/sites/Probe',siteCollectionId:id,webId:id,resources:[{key:'probe_requests',displayName:'Probe',template:'genericList',columns:[{name:'RequestLabel',kind:'text',required:true,multiline:false,maxLength:120}]}]};
 const planFile=path.join(root,'cubefarm.sharepoint.json');await fs.writeFile(planFile,JSON.stringify(plan));
 const hash=sharepointHash(sharepointPlan.parse(plan)),journal={planSha256:hash,authority:JSON.stringify({repoId:repo}),entries:[{key:'probe_requests',marker:`CubeFarm:${hash}:${id}`,payloadSha256:'a'.repeat(64),status:'verified',id}]};
 const dir=path.join(root,'planning','sharepoint-provisioning');await fs.mkdir(dir,{recursive:true});const journalFile=path.join(dir,hash+'.json');await fs.writeFile(journalFile,JSON.stringify(journal));
 const metadata={name:id,schema:{type:'array',items:{type:'object',properties:{Title:{type:'string'},RequestLabel:{type:'string'}}}}};
 const call=vi.fn(async()=>structuredClone(metadata)),flow={call,close:vi.fn(async()=>{})},run=()=>sharepointConnectorSchema(root,root,repo,'probe_requests',identity,'existing-connection',flow,()=>{});
 return {root,plan,planFile,journal,journalFile,metadata,call,run};
}
it('uses exactly one doubly encoded native dataset request for the verified recorded list',async()=>{
 const f=await fixture(),result=await f.run();
 expect(f.call).toHaveBeenCalledOnce();expect(f.call).toHaveBeenCalledWith('invoke_operation',{env:id,connector:'shared_sharepointonline',connection:'existing-connection',operation:'GetTable',params:{dataset:encodeURIComponent(f.plan.siteUrl),table:id}});
 const params=(f.call.mock.calls[0] as unknown as [string,{params:{dataset:string}}])[1].params;
 expect(encodeURIComponent(params.dataset)).toBe(encodeURIComponent(encodeURIComponent(f.plan.siteUrl)));
 expect(result.metadata).toEqual(f.metadata);expect(result.scope).toBe('native-sharepoint-list-schema');
 expect(result).toMatchObject({connectionId:'existing-connection',environmentId:id,tenantId:id,username:identity.username,listId:id});
 expect(result.limits).toContain('Native connector field metadata only; not effective item-write rights, application runtime or QA approval');
 expect(await fs.readFile(f.journalFile,'utf8')).toBe(JSON.stringify(f.journal));
});
it.each(['foreign-repo','pending','wrong-plan','duplicate','missing-id','migrated'] as const)('does not invoke the connector for %s provenance',async mode=>{
 const f=await fixture();if(mode==='foreign-repo')f.journal.authority=JSON.stringify({repoId:'other/repo'});if(mode==='pending')f.journal.entries[0].status='dispatched';if(mode==='wrong-plan')f.journal.planSha256='b'.repeat(64);if(mode==='duplicate')f.journal.entries.push(f.journal.entries[0]);if(mode==='missing-id')delete (f.journal.entries[0] as {id?:string}).id;if(mode==='migrated')Object.assign(f.journal.entries[0],{migration:'c'.repeat(64)});await fs.writeFile(f.journalFile,JSON.stringify(f.journal));
 await expect(f.run()).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();
});
it('rejects identity drift and caller-selected unknown resources before native dispatch',async()=>{
 const f=await fixture();await expect(sharepointConnectorSchema(f.root,f.root,repo,'probe_requests',{...identity,username:'other@example.test'},'existing', {call:f.call,close:async()=>{}},()=>{})).rejects.toThrow('identity');
 await expect(sharepointConnectorSchema(f.root,f.root,repo,'other',identity,'existing',{call:f.call,close:async()=>{}},()=>{})).rejects.toThrow('Unknown');expect(f.call).not.toHaveBeenCalled();
});
it.each(['descriptor','wrong-list','missing-column','drift','provider-error','null-field','empty-field','unsupported-type','missing-required-field'] as const)('does not return usable schema on %s',async mode=>{
 const f=await fixture();f.call.mockImplementation(async()=>{if(mode==='provider-error')throw Error('native400');if(mode==='drift')await fs.appendFile(f.planFile,' ');if(mode==='descriptor')return {parameters:[{dynamicType:'dynamic-schema'}]} as never;const value=structuredClone(f.metadata);if(mode==='wrong-list')value.name='other';if(mode==='missing-column')delete (value.schema.items.properties as Record<string,unknown>).RequestLabel;if(mode==='null-field')Object.assign(value.schema.items.properties,{RequestLabel:null});if(mode==='empty-field')Object.assign(value.schema.items.properties,{Title:{}});if(mode==='unsupported-type')Object.assign(value.schema.items.properties,{Title:{type:'unknown'}});if(mode==='missing-required-field')Object.assign(value.schema.items,{required:['Absent']});return value;});
 await expect(f.run()).rejects.toThrow();expect(f.call).toHaveBeenCalledOnce();
});
