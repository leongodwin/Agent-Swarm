import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {seedRetainedCloud,guid,target} from './testFixtures/retainedCloud.ts';
import {reconcileRetainedCloudHistory,type RetainedObserver} from './retainedCloudRecovery.ts';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(edit?:(state:any)=>void){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retained-cloud-qa-'));roots.push(root);
 const {bytes,lease,row,input}=await seedRetainedCloud(root,edit);
 const observer:RetainedObserver={verifyTarget:vi.fn(async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:target.environmentUrl,...target.binding,...target.identity})),importJob:vi.fn(async()=>({...row}))};
 return {root,bytes,lease,observer,input,row};
}
it('archives exact original uncertain history and records terminal observations without certifying success or replaying',async()=>{
 const f=await fixture();const resource='deployment:'+target.environmentUrl;const leases=path.join(f.root,'resource-leases');await fs.mkdir(leases);
 const held=path.join(leases,crypto.createHash('sha256').update(resource).digest('hex')+'.json');const heldBytes=JSON.stringify({resource,owner:'run',pid:2147483647,token:crypto.randomUUID(),acquiredAt:'2026-01-01T00:00:00.000Z'});await fs.writeFile(held,heldBytes);
 const receipt=await reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{});
 expect(receipt).toMatchObject({remoteTerminalityVerified:true,deploymentOutcomeVerified:false,releaseApproved:false,maintenanceRequired:true,resourceLeasesReleased:false,deliveryLeaseReleased:false});
 expect(receipt.targets).toEqual([target]);expect(receipt.identityObservations).toHaveLength(4);
 for(const identity of receipt.identityObservations)expect(identity).toMatchObject({...target.binding,...target.identity,environmentUrl:target.environmentUrl});
 expect(f.observer.importJob).toHaveBeenCalledTimes(2);expect(f.observer.verifyTarget).toHaveBeenCalledTimes(4);
 expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
 expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
 expect(await fs.readFile(held,'utf8')).toBe(heldBytes);
 expect(receipt.targetLeases.leases).toHaveLength(1);
 expect(receipt.nativeCommands).toMatchObject({coverage:'legacy-or-missing',nativeTreeQuiescenceVerified:false});
 expect(receipt.targetLeases).toMatchObject({resourceLeasesReleased:false,resumptionAuthorized:false});
 const files=await fs.readdir(path.join(f.root,'delivery-recovery'));
 expect(await fs.readFile(path.join(f.root,'delivery-recovery',files.find(name=>name.endsWith('.state.json'))!),'utf8')).toBe(f.bytes);
 expect(await fs.readFile(path.join(f.root,'delivery-recovery',files.find(name=>name.endsWith('.lock.json'))!),'utf8')).toBe(f.lease);
 expect(JSON.parse(f.bytes).runs[0].operations[0].status).toBe('unknown');
});
it('rejects terminal job metadata changing between two otherwise valid observations',async()=>{
 const f=await fixture();let calls=0;f.observer.importJob=vi.fn(async()=>({...f.row,completedon:++calls===1?f.row.completedon:'2026-01-01T00:02:00.000Z'}));
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow('changed between passes');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
it('rejects a live replacement lease created while provider observation is pending',async()=>{
 const f=await fixture();const successor=JSON.stringify({schemaVersion:1,pid:process.pid,token:'33333333-3333-4333-8333-333333333333',acquiredAt:new Date().toISOString()});f.observer.importJob=vi.fn(async()=>{await fs.writeFile(path.join(f.root,'delivery.lock'),successor);return f.row;});
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow('changed');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(successor);
});
it('refuses repeated platform job identity attributed to separate retained runs',async()=>{
 const f=await fixture(state=>state.runs.push({...structuredClone(state.runs[0]),id:'other-run'}));
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow('reuses');expect(f.observer.importJob).not.toHaveBeenCalled();
});
it.each(['/foreign-path','?foreign=query',':444'] as const)('rejects stored target root ambiguity %s before provider reads',async suffix=>{
 const f=await fixture(state=>{state.policy.environmentUrl=`${target.environmentUrl}${suffix}`;});
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow();expect(f.observer.verifyTarget).not.toHaveBeenCalled();expect(f.observer.importJob).not.toHaveBeenCalled();expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
it.each(['missing-id','post-deploy','no-journal','no-checkpoint','unapproved','missing-package','foreign-target'] as const)('rejects unsupported %s before remote observations',async mode=>{
 const f=await fixture(s=>{const run=s.runs[0];if(mode==='missing-id')delete run.operations[0].platformJobId;if(mode==='post-deploy')run.operations[0].kind='post-deploy';if(mode==='no-journal')run.operations=[];if(mode==='no-checkpoint')delete run.checkpoint;if(mode==='unapproved'){delete s.releases[0].approvedAt;delete s.releases[0].approvedBy;}if(mode==='missing-package')delete run.recovery;if(mode==='foreign-target')s.policy.environmentUrl='https://other.crm4.dynamics.com';});
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow();expect(f.observer.importJob).not.toHaveBeenCalled();expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
it.each(['pending','wrong-job','wrong-solution','future','reversed','old-start','pagination'] as const)('rejects %s terminal data without releasing ownership',async mode=>{
 const f=await fixture();const row:any={...f.row};if(mode==='pending'){row.progress=99;row.completedon=null;}if(mode==='wrong-job')row.importjobid=guid;if(mode==='wrong-solution')row.solutionname='Foreign';if(mode==='future')row.completedon='2999-01-01T00:00:00.000Z';if(mode==='reversed')row.completedon='2025-01-01T00:00:00.000Z';if(mode==='old-start')row.startedon='2025-01-01T00:00:00.000Z';if(mode==='pagination')row['@odata.nextLink']='https://foreign.test';f.observer.importJob=vi.fn(async()=>row);
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow();expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
});
it('rejects a history generation changed during a slow observation',async()=>{
 const f=await fixture();f.observer.importJob=vi.fn(async()=>{await fs.appendFile(path.join(f.root,'delivery.json'),' ');return f.row;});
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow('changed');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
it('rejects concurrent recovery while the first observation remains pending',async()=>{
 const f=await fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 f.observer.importJob=vi.fn(async()=>{entered();await pending;return f.row;});const first=reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{});await started;
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow('already in progress');release();await first;
});
it('keeps the exact marker when maintenance authorization is revoked during observations',async()=>{
 const f=await fixture();let open=true;f.observer.importJob=vi.fn(async()=>{open=false;return f.row;});
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{if(!open)throw new Error('closed');})).rejects.toThrow('closed');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
it.each(['missing','stale','future','foreign-user','foreign-tenant','foreign-environment'] as const)('rejects %s identity observations before querying retained jobs',async mode=>{
 const f=await fixture();const evidence:any={scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:target.environmentUrl,...target.binding,...target.identity};
 if(mode==='missing')delete evidence.tenantId;if(mode==='stale')evidence.checkedAt='2026-01-01T00:00:00.000Z';if(mode==='future')evidence.checkedAt='2999-01-01T00:00:00.000Z';if(mode==='foreign-user')evidence.userId='33333333-3333-4333-8333-333333333333';if(mode==='foreign-tenant')evidence.tenantId='33333333-3333-4333-8333-333333333333';if(mode==='foreign-environment')evidence.environmentUrl='https://foreign.crm4.dynamics.com';
 f.observer.verifyTarget=vi.fn(async()=>evidence);
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{})).rejects.toThrow();expect(f.observer.importJob).not.toHaveBeenCalled();expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
it.each(['state-change','closed'] as const)('never publishes a finalized receipt after %s during archive writing',async mode=>{
 const f=await fixture();const originalOpen=fs.open;let open=true;
 vi.spyOn(fs,'open').mockImplementation(async(...args:Parameters<typeof fs.open>)=>{const file=await originalOpen(...args);if(String(args[0]).endsWith('.pending')){if(mode==='state-change')await fs.appendFile(path.join(f.root,'delivery.json'),' ');else open=false;}return file;});
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{if(!open)throw new Error('closed');})).rejects.toThrow();
 const files=await fs.readdir(path.join(f.root,'delivery-recovery'));
 expect(files.some(name=>name.endsWith('.pending'))).toBe(true);expect(files.filter(name=>name.endsWith('.json')&&!name.endsWith('.state.json')&&!name.endsWith('.lock.json'))).toEqual([]);
 expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
});
