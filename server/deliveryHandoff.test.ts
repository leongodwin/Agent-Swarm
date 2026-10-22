import {bindNativeHandoffFixture} from './testFixtures/nativeHandoff.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {seedRetainedCloud} from './testFixtures/retainedCloud.ts';
import {initializeNativeEpoch,journalNativeCommand} from './nativeCommandJournal.ts';
import {runNativeTree} from './nativeTree.ts';
import {reconcileRetainedCloudHistory} from './retainedCloudRecovery.ts';
import {handoffRetainedDelivery,rollbackDeliveryHandoff} from './deliveryHandoff.ts';
import {acquireDeliveryLease} from './deliveryLease.ts';
import {acquireResourceLease} from './resourceLease.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
export async function handoffFixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-handoff-'));roots.push(root);const f=await seedRetainedCloud(root),hash=crypto.createHash('sha256').update(f.lease).digest('hex'),resourceRoot=path.join(root,'resource-leases');await fs.mkdir(resourceRoot);
 const resource='deployment:'+f.target.environmentUrl,file=path.join(resourceRoot,crypto.createHash('sha256').update(resource).digest('hex')+'.json');
 const leaseBytes=JSON.stringify({resource,owner:'run',pid:2147483647,token:crypto.randomUUID(),acquiredAt:'2026-01-01T00:00:00.000Z'});await fs.writeFile(file,leaseBytes);
 await bindNativeHandoffFixture(root,f,{executable:'git',args:['rev-parse','HEAD']});
 await initializeNativeEpoch(root,hash);
 // Native supervision is real; cloud identity/job rows are isolated fixtures.
 // Intent names a supported CLI; the injected test dispatch runs bounded Node.
 await journalNativeCommand(root,hash,{executable:'git',args:['rev-parse','HEAD']},root,'run',async()=>{},context=>runNativeTree(process.execPath,['-e','process.exit(0)'],root,{},new AbortController().signal,context));
 const observer={verifyTarget:async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:f.target.environmentUrl,...f.target.binding,...f.target.identity}),importJob:async()=>f.row};
 const audit=await reconcileRetainedCloudHistory(root,f.input,observer,()=>{},resourceRoot);
 return {...f,root,resourceRoot,resource,file,leaseBytes,audit};
}
it.skipIf(process.platform!=='win32')('hands off exact leases after real native tree proof and synthetic terminal cloud observations',async()=>{
 const f=await handoffFixture();const result=await handoffRetainedDelivery(f.root,f.resourceRoot,f.audit,()=>{});
 expect(result).toMatchObject({maintenanceRequired:true,deploymentOutcomeVerified:false});expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
 expect(await fs.readFile(path.join(f.root,'delivery-recovery',result.id,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.root,'delivery-recovery',result.id,path.basename(f.file)),'utf8')).toBe(f.leaseBytes);
 const delivery=await acquireDeliveryLease(f.root),target=await acquireResourceLease(f.resourceRoot,f.resource,'new');await target.release();await delivery.release();
},20000);
it.skipIf(process.platform!=='win32').each(['prepared','resource-moved','global-moved'])('fences both startup and targets after interruption at %s and restores exact history on explicit rollback',async stage=>{
 const f=await handoffFixture();await expect(handoffRetainedDelivery(f.root,f.resourceRoot,f.audit,()=>{},async name=>{if(name===stage)throw new Error('simulated interruption');})).rejects.toThrow('simulated interruption');
 await expect(acquireDeliveryLease(f.root)).rejects.toThrow('Incomplete');await expect(acquireResourceLease(f.resourceRoot,f.resource,'new')).rejects.toThrow('Incomplete');
 expect(await rollbackDeliveryHandoff(f.root,f.resourceRoot,()=>{})).toBe('rolled-back');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(f.file,'utf8')).toBe(f.leaseBytes);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
},20000);
