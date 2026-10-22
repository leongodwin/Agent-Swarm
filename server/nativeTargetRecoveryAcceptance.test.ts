import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {seedRetainedCloud} from './testFixtures/retainedCloud.ts';
import {reconcileRetainedCloudHistory} from './retainedCloudRecovery.ts';
import {journalNativeCommand} from './nativeCommandJournal.ts';
import {acquireResourceLease} from './resourceLease.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-target-recovery-'));roots.push(root);const f=await seedRetainedCloud(root);
 const leases=path.join(root,'external-leases');await fs.mkdir(leases);const resource='deployment:'+f.target.environmentUrl;
 const file=path.join(leases,crypto.createHash('sha256').update(resource).digest('hex')+'.json');
 const bytes=JSON.stringify({resource,owner:'run',pid:2147483647,token:crypto.randomUUID(),acquiredAt:'2026-01-01T00:00:00.000Z'});await fs.writeFile(file,bytes);
 const observer={verifyTarget:vi.fn(async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:f.target.environmentUrl,...f.target.binding,...f.target.identity})),importJob:vi.fn(async()=>({...f.row}))};
 return {...f,root,leases,resource,file,heldBytes:bytes,observer};
}
it('uses configured external lease inventory and preserves guarded native/target holds on terminal cloud observations',async()=>{
 const f=await fixture();f.observer.importJob.mockImplementation(async()=>{
  await expect(acquireResourceLease(f.leases,f.resource,'competing')).rejects.toThrow('progress');return f.row;
 });
 const receipt=await reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{},f.leases);
 expect(receipt).toMatchObject({resumptionAuthorized:false,nativeTreeQuiescenceVerified:false,deliveryLeaseReleased:false,resourceLeasesReleased:false});expect(receipt.targetLeases.leases).toHaveLength(1);
 expect(await fs.readFile(f.file,'utf8')).toBe(f.heldBytes);expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readdir(f.leases)).toEqual([path.basename(f.file)]);
});
it.each(['owner-drift','extra-target','native-drift','cancel'])('refuses final publication after %s during provider observation',async fault=>{
 const f=await fixture(),leaseSha=crypto.createHash('sha256').update(f.lease).digest('hex');
 await journalNativeCommand(f.root,leaseSha,{executable:'synthetic',args:[]},f.root,undefined,async()=>{},async()=>{});
 let changed=false,open=true;
 f.observer.importJob.mockImplementation(async()=>{
  if(!changed){changed=true;
   if(fault==='owner-drift')await fs.writeFile(f.file,JSON.stringify({...JSON.parse(f.heldBytes),owner:'successor'}));
   if(fault==='extra-target')await acquireResourceLease(f.leases,'unrelated','successor');
   if(fault==='native-drift'){const directory=path.join(f.root,'delivery-native',leaseSha),name=(await fs.readdir(directory)).find(name=>name.endsWith('.result.json'))!,file=path.join(directory,name),result=JSON.parse(await fs.readFile(file,'utf8'));result.outcome='rejected';await fs.writeFile(file,JSON.stringify(result));}
   if(fault==='cancel')open=false;
  }return f.row;
 });
 await expect(reconcileRetainedCloudHistory(f.root,f.input,f.observer,()=>{if(!open)throw new Error('cancelled');},f.leases)).rejects.toThrow();
 expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
 const audit=(await fs.readdir(path.join(f.root,'delivery-recovery')).catch(()=>[])).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name));expect(audit).toEqual([]);expect((await fs.readdir(f.leases)).some(name=>name.endsWith('.reaping'))).toBe(false);
});
