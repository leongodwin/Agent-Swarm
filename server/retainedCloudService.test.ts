import {bindNativeHandoffFixture} from './testFixtures/nativeHandoff.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {initializeNativeEpoch,journalNativeCommand} from './nativeCommandJournal.ts';
import {afterEach,expect,it,vi} from 'vitest';
import {DeliveryService,type DeliveryDependencies} from './delivery.ts';
import {seedRetainedCloud} from './testFixtures/retainedCloud.ts';
const roots:string[]=[],services:DeliveryService[]=[];
afterEach(async()=>{vi.useRealTimers();for(const service of services.splice(0))await service.close();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retained-cloud-service-'));roots.push(root);const f=await seedRetainedCloud(root);
 const run=vi.fn<DeliveryDependencies['run']>(async command=>{
  if(command.executable!=='dataverse')throw new Error('Unexpected executable');
  if(command.args.join(' ')==='auth who')return `Tenant: ${f.target.identity.tenantId}\nUser: ${f.target.identity.username}\nEnvironment: ${f.target.environmentUrl}`;
  expect(command.args).toContain('GET');expect(command.args).toContain(f.target.environmentUrl);expect(command.args).not.toContain('--body');
  const resource=command.args.at(-1)!;
  if(resource.endsWith('/WhoAmI'))return JSON.stringify({OrganizationId:f.target.binding.organizationId,UserId:f.target.binding.userId});
  if(resource.includes('RetrieveCurrentOrganization'))return JSON.stringify({Detail:{OrganizationId:f.target.binding.organizationId,TenantId:f.target.identity.tenantId,EnvironmentId:f.target.identity.environmentId,State:'Enabled'}});
  if(resource.includes('/importjobs('))return JSON.stringify(f.row);
  throw new Error('Unexpected read path');
 });
 const service=new DeliveryService(root,false,{run});services.push(service);await service.init({allowUnavailable:true});return {...f,root,run,service};
}
it('runs fresh native GET/identity observations while preserving every deployment hold and uncertain operation',async()=>{
 const f=await fixture();await expect(f.service.reconcileRetainedStartup(f.input)).rejects.toThrow('maintenance');expect(f.run).not.toHaveBeenCalled();
 f.service.setDraining(true);const receipt=await f.service.reconcileRetainedStartup(f.input);
 expect(receipt).toMatchObject({remoteTerminalityVerified:true,deliveryLeaseReleased:false,resourceLeasesReleased:false,releaseApproved:false,deploymentOutcomeVerified:false});
 expect(receipt.identityObservations).toHaveLength(4);expect(receipt.observations).toHaveLength(2);
 expect(f.run.mock.calls.filter(([c])=>c.args.at(-1)?.includes('/importjobs('))).toHaveLength(2);
 expect(f.service.available).toBe(false);expect(f.service.isDraining).toBe(true);expect(f.service.view().availability).toBe('unavailable');
 expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
 await expect(f.service.configure(f.target.environmentUrl,true)).rejects.toThrow();expect(()=>f.service.setDraining(false)).toThrow();
});
it('does not execute observations after external authentication ownership is revoked',async()=>{
 const f=await fixture();f.service.setDraining(true);await expect(f.service.reconcileRetainedStartup(f.input,()=>{throw new Error('Ownership unresolved');})).rejects.toThrow('Ownership unresolved');expect(f.run).not.toHaveBeenCalled();
});
it.each(['close','deadline'])('aborts pending native reads on %s and never releases ownership',async cause=>{
 const f=await fixture();f.service.setDraining(true);if(cause==='deadline')vi.useFakeTimers();
 let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 f.run.mockImplementation(async(_command,_cwd,_env,signal)=>new Promise((_resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(new Error('Native read aborted')),{once:true});}));
 const pending=f.service.reconcileRetainedStartup(f.input);const checked=expect(pending).rejects.toThrow('Native read aborted');await entered;
 await expect(f.service.reconcileRetainedStartup(f.input)).rejects.toThrow('maintenance');
 if(cause==='close')await f.service.close();else await vi.advanceTimersByTimeAsync(120000);
 await checked;expect(f.service.available).toBe(false);expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);
 expect(await fs.stat(path.join(f.root,'delivery-recovery')).catch(()=>undefined)).toBeUndefined();
});

it.skipIf(process.platform!=='win32')('resumes only the reconciled service in durable maintenance, preserving uncertain checkpoints and independent approvals',async()=>{
 const f=await fixture(),hash=crypto.createHash('sha256').update(f.lease).digest('hex');
 await bindNativeHandoffFixture(f.root,f,{executable:'pac',args:['solution','import']});
 await initializeNativeEpoch(f.root,hash);
 await journalNativeCommand(f.root,hash,{executable:'pac',args:['solution','import']},f.root,'run',async()=>{},async context=>{await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:context.id,intentSha256:context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));});
 f.service.setDraining(true);const result=await f.service.reconcileRetainedStartup(f.input,()=>{},true);
 expect(result).toMatchObject({scope:'delivery-maintenance-resumption',maintenanceRequired:true,deploymentOutcomeVerified:false,releaseApproved:false});
 expect(f.service.available).toBe(true);expect(f.service.isDraining).toBe(true);const view=f.service.view();expect(view.runs[0]).toMatchObject({phase:'blocked',checkpoint:'import-started',recoveryRequired:true});expect(view.runs[0].operations?.[0].status).toBe('unknown');
 expect(f.run.mock.calls.every(([command])=>command.executable==='dataverse')).toBe(true);
 await f.service.close();const restarted=new DeliveryService(f.root,false,{run:f.run});services.push(restarted);await restarted.init();expect(restarted.isDraining).toBe(true);restarted.setDraining(false);expect(restarted.isDraining).toBe(false);await expect(fs.stat(path.join(f.root,'delivery-handoff-maintenance.json'))).rejects.toMatchObject({code:'ENOENT'});
},20000);
