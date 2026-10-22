import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {DeliveryService} from './delivery.ts';
import {reconcileLauncherDelivery} from './launcherDeliveryRecovery.ts';
import {inspectDeliveryRecovery} from './deliveryRecovery.ts';
import {recoverEmptyDelivery} from './deliveryRecovery.ts';
const roots:string[]=[],services:DeliveryService[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const service of services.splice(0))await service.close();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(pid=2147483647){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-reconciliation-'));roots.push(root);
 const lease=JSON.stringify({schemaVersion:1,pid,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()});
 const history=JSON.stringify({schemaVersion:1,policy:null,runs:[],releases:[],blockers:[],revision:0,attemptHistory:{version:1,startedAt:new Date().toISOString(),legacyRunIds:[],attempts:[]}});
 await fs.writeFile(path.join(root,'delivery.lock'),lease);await fs.writeFile(path.join(root,'delivery.json'),history);
 const service=new DeliveryService(root,false);services.push(service);await service.init({allowUnavailable:true});
 return {root,lease,history,service};
}
const allowed={enabled:true,launcher:true,crashedOwnerPid:'2147483647'};
it.each([false,true])('recovers exact absent owner while preserving history and prior maintenance %s',async draining=>{
 const {root,lease,history,service}=await fixture();if(draining)service.setDraining(true);
 expect(await reconcileLauncherDelivery(root,service,allowed)).toBe(true);expect(service.available).toBe(true);expect(service.isDraining).toBe(draining);
 expect(JSON.parse(await fs.readFile(path.join(root,'delivery.json'),'utf8'))).toEqual(JSON.parse(history));
 const names=await fs.readdir(path.join(root,'delivery-recovery'));expect(names).toHaveLength(2);
 expect(await fs.readFile(path.join(root,'delivery-recovery',names.find(n=>n.endsWith('.lock.json'))!),'utf8')).toBe(lease);
 const receipt=JSON.parse(await fs.readFile(path.join(root,'delivery-recovery',names.find(n=>!n.endsWith('.lock.json'))!),'utf8'));
 expect(receipt).toMatchObject({authorisation:'operator-opt-in-owned-launcher-crash',crashedOwnerPid:2147483647,remoteOutcomeVerified:false,runs:0,releases:0,attempts:0});
});
it.each([{enabled:false},{launcher:false},...['','0','-1','1.1','NaN','2147483648','9007199254740992','1e2',' 2147483647'].map(crashedOwnerPid=>({crashedOwnerPid}))])('leaves ownership untouched for unauthorized context %j',async override=>{
 const {root,lease,service}=await fixture();expect(await reconcileLauncherDelivery(root,service,{...allowed,...override})).toBe(false);
 expect(service.available).toBe(false);expect(service.isDraining).toBe(false);expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(lease);
 expect(await fs.stat(path.join(root,'delivery-recovery')).catch(()=>undefined)).toBeUndefined();
});
it('does not archive, interrupt or reinitialize an already healthy delivery owner',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-reconciliation-'));roots.push(root);
 const service=new DeliveryService(root,false);services.push(service);await service.init();
 const before=await fs.readFile(path.join(root,'delivery.lock'));const recover=vi.spyOn(service,'recoverStartup');
 expect(await reconcileLauncherDelivery(root,service,allowed)).toBe(false);expect(recover).not.toHaveBeenCalled();expect(service.available).toBe(true);expect(service.isDraining).toBe(false);
 expect(await fs.readFile(path.join(root,'delivery.lock'))).toEqual(before);expect(await fs.stat(path.join(root,'delivery-recovery')).catch(()=>undefined)).toBeUndefined();
});
it.each([0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('refuses invalid direct crashed-owner binding %s without moving evidence',async pid=>{
 const {root,lease,history}=await fixture();const view=await inspectDeliveryRecovery(root);
 await expect(recoverEmptyDelivery(root,view.snapshotSha256!,()=>{},pid)).rejects.toThrow('launcher-observed');
 expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(lease);expect(await fs.readFile(path.join(root,'delivery.json'),'utf8')).toBe(history);
 expect(await fs.stat(path.join(root,'delivery-recovery')).catch(()=>undefined)).toBeUndefined();
});
it('rejects a valid dead marker belonging to a different crash and preserves safe maintenance',async()=>{
 const {root,lease,service}=await fixture();await expect(reconcileLauncherDelivery(root,service,{...allowed,crashedOwnerPid:'2147483646'})).rejects.toThrow('launcher-observed');
 expect(service.isDraining).toBe(true);expect(service.available).toBe(false);expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(lease);
});
it.each(['live','permission-denied','history','invalid'] as const)('never treats %s evidence as reconciled',async mode=>{
 const {root,lease,service}=await fixture();
 if(mode==='live')await fs.writeFile(path.join(root,'delivery.lock'),lease.replace('2147483647',String(process.pid)));
 if(mode==='permission-denied')vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});});
 if(mode==='history'){
  const file=path.join(root,'delivery.json'),history=JSON.parse(await fs.readFile(file,'utf8'));
  history.runs=[{id:'legacy',repoId:'synthetic/repo',head:'legacy',environmentUrl:'https://synthetic.crm4.dynamics.com',phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:[],log:[],operations:[]}];history.attemptHistory.legacyRunIds=['legacy'];await fs.writeFile(file,JSON.stringify(history));
 }
 if(mode==='invalid')await fs.writeFile(path.join(root,'delivery.json'),'{');
 const before=await fs.readFile(path.join(root,'delivery.lock'));expect((await inspectDeliveryRecovery(root)).canRecover).toBe(false);
 expect(await reconcileLauncherDelivery(root,service,allowed)).toBe(false);expect(service.available).toBe(false);expect(await fs.readFile(path.join(root,'delivery.lock'))).toEqual(before);
});
it('keeps unavailable delivery in maintenance after a recovery exception without masking its cause',async()=>{
 const {root,service}=await fixture();vi.spyOn(service,'recoverStartup').mockRejectedValue(new Error('Synthetic storage unavailable'));
 await expect(reconcileLauncherDelivery(root,service,allowed)).rejects.toThrow('Synthetic storage');expect(service.isDraining).toBe(true);expect(service.available).toBe(false);
});
