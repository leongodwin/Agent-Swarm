import {bindNativeHandoffFixture} from './testFixtures/nativeHandoff.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {seedRetainedCloud} from './testFixtures/retainedCloud.ts';
import {initializeNativeEpoch,journalNativeCommand} from './nativeCommandJournal.ts';
import {reconcileRetainedCloudHistory} from './retainedCloudRecovery.ts';
import {handoffRetainedDelivery,rollbackDeliveryHandoff} from './deliveryHandoff.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-boundary-'));roots.push(root);const f=await seedRetainedCloud(root),resources=path.join(root,'resources');await fs.mkdir(resources);
 const resource='deployment:'+f.target.environmentUrl,name=crypto.createHash('sha256').update(resource).digest('hex')+'.json';
 const held=JSON.stringify({resource,owner:'run',pid:2147483647,token:crypto.randomUUID(),acquiredAt:'2026-01-01T00:00:00.000Z'});await fs.writeFile(path.join(resources,name),held);
 await bindNativeHandoffFixture(root,f,{executable:'pac',args:['solution','import']});
 const hash=crypto.createHash('sha256').update(f.lease).digest('hex');await initializeNativeEpoch(root,hash);
 await journalNativeCommand(root,hash,{executable:'pac',args:['solution','import']},root,'run',async()=>{},async context=>{await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:context.id,intentSha256:context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));});
 const audit=await reconcileRetainedCloudHistory(root,f.input,{verifyTarget:async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:f.target.environmentUrl,...f.target.binding,...f.target.identity}),importJob:async()=>f.row},()=>{},resources);
 return {...f,root,resources,name,held,audit,hash};
}
it.skipIf(process.platform!=='win32').each(['stale','future','unpublished','snapshot','target','state','native','epoch','cancel'])('refuses %s handoff evidence without clearing any owner',async mode=>{
 const f=await fixture(),audit=structuredClone(f.audit),auditFile=path.join(f.root,'delivery-recovery',audit.id+'.json');
 if(mode==='stale'||mode==='future'){audit.at=mode==='stale'?'2000-01-01T00:00:00.000Z':'2999-01-01T00:00:00.000Z';await fs.writeFile(auditFile,JSON.stringify(audit));}
 if(mode==='unpublished')audit.deploymentOutcomeVerified=true;
 if(mode==='snapshot'){audit.snapshotSha256='0'.repeat(64);await fs.writeFile(auditFile,JSON.stringify(audit));}
 if(mode==='target')await fs.writeFile(path.join(f.resources,f.name),JSON.stringify({...JSON.parse(f.held),owner:'successor'}));
 if(mode==='state')await fs.appendFile(path.join(f.root,'delivery.json'),' ');
 if(mode==='native')await journalNativeCommand(f.root,f.hash,{executable:'npm',args:['run','build']},f.root,undefined,async()=>{},async()=>{});
 if(mode==='epoch')await fs.writeFile(path.join(f.root,'delivery-native',f.hash,'epoch.json'),'{}');
 await expect(handoffRetainedDelivery(f.root,f.resources,audit,()=>{if(mode==='cancel')throw new Error('cancelled');})).rejects.toThrow();
 expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.stat(path.join(f.resources,f.name))).toBeDefined();await expect(fs.stat(path.join(f.root,'delivery-handoff.json'))).rejects.toMatchObject({code:'ENOENT'});
},15000);
it.skipIf(process.platform!=='win32').each(['foreign-fence','damaged-plan','missing-archive','foreign-guard','cancel'])('preserves pending holds when rollback encounters %s',async mode=>{
 const f=await fixture();await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{},async stage=>{if(stage==='resource-moved')throw new Error('interrupted');})).rejects.toThrow('interrupted');
 const pending=path.join(f.root,'delivery-handoff.json'),plan=JSON.parse(await fs.readFile(pending,'utf8'));
 if(mode==='foreign-fence')await fs.writeFile(path.join(f.resources,'delivery-handoff.pending'),'{}');
 if(mode==='damaged-plan')await fs.writeFile(pending,'{}');
 if(mode==='missing-archive')await fs.unlink(path.join(f.root,'delivery-recovery',plan.id,f.name));
 if(mode==='foreign-guard'){const guard=path.join(f.root,'delivery.lock.reaping');await fs.mkdir(guard);await fs.writeFile(path.join(guard,'handoff-owner.json'),JSON.stringify({pid:2147483647,token:crypto.randomUUID()}));}
 await expect(rollbackDeliveryHandoff(f.root,f.resources,()=>{if(mode==='cancel')throw new Error('cancelled');})).rejects.toThrow();
 expect(await fs.stat(pending)).toBeDefined();expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);await expect(fs.stat(path.join(f.resources,f.name))).rejects.toMatchObject({code:'ENOENT'});
},15000);
