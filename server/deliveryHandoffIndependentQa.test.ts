import {bindNativeHandoffFixture} from './testFixtures/nativeHandoff.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {afterEach,expect,it,vi} from 'vitest';
import {seedRetainedCloud} from './testFixtures/retainedCloud.ts';
import {initializeNativeEpoch,journalNativeCommand} from './nativeCommandJournal.ts';
import {reconcileRetainedCloudHistory} from './retainedCloudRecovery.ts';
import {handoffRetainedDelivery,rollbackDeliveryHandoff} from './deliveryHandoff.ts';
import {acquireDeliveryLease} from './deliveryLease.ts';
import {acquireResourceLease} from './resourceLease.ts';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(bindingFault?:'legacy'|'foreign-epoch'|'command-digest'|'foreign-run'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-independent-'));roots.push(root);const f=await seedRetainedCloud(root),resources=path.join(root,'resources');await fs.mkdir(resources);
 const resource='deployment:'+f.target.environmentUrl,name=crypto.createHash('sha256').update(resource).digest('hex')+'.json';
 const held=JSON.stringify({resource,owner:'run',pid:2147483647,token:crypto.randomUUID(),acquiredAt:'2026-01-01T00:00:00.000Z'});await fs.writeFile(path.join(resources,name),held);
 await bindNativeHandoffFixture(root,f,{executable:'pac',args:['solution','import']});
 if(bindingFault){const state=JSON.parse(f.bytes);if(bindingFault==='legacy')delete state.runs[0].nativeLeaseSha256;if(bindingFault==='foreign-epoch')state.runs[0].nativeLeaseSha256='f'.repeat(64);if(bindingFault==='command-digest')state.runs[0].operations[0].commandSha256='e'.repeat(64);f.bytes=JSON.stringify(state);f.input.snapshotSha256=crypto.createHash('sha256').update(f.lease).update('\0').update(f.bytes).digest('hex');await fs.writeFile(path.join(root,'delivery.json'),f.bytes);}
 const leaseHash=crypto.createHash('sha256').update(f.lease).digest('hex');await initializeNativeEpoch(root,leaseHash);
 await journalNativeCommand(root,leaseHash,{executable:'pac',args:['solution','import']},root,bindingFault==='foreign-run'?'other-run':'run',async()=>{},async context=>{await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:context.id,intentSha256:context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));});
 const observer={verifyTarget:async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:f.target.environmentUrl,...f.target.binding,...f.target.identity}),importJob:async()=>({...f.row})};
 const audit=await reconcileRetainedCloudHistory(root,f.input,observer,()=>{},resources);
 return {...f,root,resources,resource,name,held,audit};
}
it.skipIf(process.platform!=='win32').each(['legacy','foreign-epoch','command-digest','foreign-run'] as const)('refuses %s retained operation attribution despite a complete newer native epoch',async fault=>{
 const f=await fixture(fault);await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{})).rejects.toThrow('legacy, different or unattributable');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.resources,f.name),'utf8')).toBe(f.held);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);expect(await fs.stat(path.join(f.root,'delivery-handoff.json')).catch(()=>undefined)).toBeUndefined();
},20000);
// Handoff and rollback each start a real Windows mutex host with a 15 s
// production startup deadline. The outer budget covers both plus fixture I/O.
it.skipIf(process.platform!=='win32').each(['prepared','resource-moved','global-moved'])('independent rollback preserves exact evidence after %s crash boundary',async fault=>{
 const f=await fixture();await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{},async step=>{if(step===fault)throw new Error('injected crash');})).rejects.toThrow('injected crash');
 await expect(acquireDeliveryLease(f.root)).rejects.toThrow();await expect(acquireResourceLease(f.resources,f.resource,'successor')).rejects.toThrow();
 expect(await rollbackDeliveryHandoff(f.root,f.resources,()=>{})).toBe('rolled-back');
 expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.resources,f.name),'utf8')).toBe(f.held);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
},35000);
it.skipIf(process.platform!=='win32')('prevalidates all records before rollback, preserving holds on foreign owner',async()=>{
 const f=await fixture();await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{},async step=>{if(step==='global-moved')throw new Error('injected crash');})).rejects.toThrow();
 await fs.writeFile(path.join(f.root,'delivery.lock'),'{"foreign":true}');await expect(rollbackDeliveryHandoff(f.root,f.resources,()=>{})).rejects.toThrow();
 expect(await fs.stat(path.join(f.resources,f.name)).catch(()=>undefined)).toBeUndefined();expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe('{"foreign":true}');expect(await fs.stat(path.join(f.root,'delivery-handoff.json'))).toBeDefined();expect(await fs.stat(path.join(f.resources,'delivery-handoff.pending'))).toBeDefined();
},35000);
it.skipIf(process.platform!=='win32')('finishes committed cleanup after global pending unlink failure without restoring old owners',async()=>{
 const f=await fixture(),unlink=fs.unlink.bind(fs);let failed=false;
 const spy=vi.spyOn(fs,'unlink').mockImplementation(async file=>{if(String(file)===path.join(f.root,'delivery-handoff.json')&&!failed){failed=true;throw new Error('cleanup unavailable');}return unlink(file);});
 await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{})).rejects.toThrow('cleanup unavailable');spy.mockRestore();
 await expect(acquireDeliveryLease(f.root)).rejects.toThrow();expect(await rollbackDeliveryHandoff(f.root,f.resources,()=>{})).toBe('committed');
 expect(await fs.stat(path.join(f.root,'delivery.lock')).catch(()=>undefined)).toBeUndefined();expect(await fs.stat(path.join(f.resources,f.name)).catch(()=>undefined)).toBeUndefined();
 const next=await acquireDeliveryLease(f.root);await next.release();
},35000);
// A single native mutex startup can consume15s before fixture/readback I/O.
it.skipIf(process.platform!=='win32')('refuses epoch disappearance after preparation and retains durable holds',async()=>{
 const f=await fixture(),leaseHash=crypto.createHash('sha256').update(f.lease).digest('hex');
 await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{},async step=>{if(step==='prepared')await fs.unlink(path.join(f.root,'delivery-native',leaseHash,'epoch.json'));})).rejects.toThrow();
 expect(await fs.stat(path.join(f.root,'delivery-handoff.json'))).toBeDefined();await expect(acquireDeliveryLease(f.root)).rejects.toThrow();await expect(acquireResourceLease(f.resources,f.resource,'next')).rejects.toThrow();
},20000);
it.skipIf(process.platform!=='win32')('does not clear a successor pending plan published before rollback guard acquisition',async()=>{
 const f=await fixture(),unlink=fs.unlink.bind(fs),pending=path.join(f.root,'delivery-handoff.json');
 const unlinkSpy=vi.spyOn(fs,'unlink').mockImplementation(async file=>{if(String(file)===pending)throw new Error('retain committed hold');return unlink(file);});
 await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{})).rejects.toThrow('retain committed hold');unlinkSpy.mockRestore();
 const original=JSON.parse(await fs.readFile(pending,'utf8')),successor={...original,id:crypto.randomUUID()},mkdir=fs.mkdir.bind(fs);let switched=false;
 const mkdirSpy=vi.spyOn(fs,'mkdir').mockImplementation(async(...args)=>{if(String(args[0])===path.join(f.root,'delivery.lock.reaping')&&!switched){switched=true;await fs.writeFile(pending,JSON.stringify(successor));}return mkdir(...args);});
 await expect(rollbackDeliveryHandoff(f.root,f.resources,()=>{})).rejects.toThrow();mkdirSpy.mockRestore();expect(JSON.parse(await fs.readFile(pending,'utf8')).id).toBe(successor.id);
},35000);
// One handoff and two rollback attempts exercise three owned 15 s mutex
// startup windows; retain every failure/ownership assertion under that budget.
it.skipIf(process.platform!=='win32')('retries rollback cleanup when unlink fails after its durable receipt',async()=>{
 const f=await fixture();await expect(handoffRetainedDelivery(f.root,f.resources,f.audit,()=>{},async step=>{if(step==='resource-moved')throw new Error('injected crash');})).rejects.toThrow();
 const unlink=fs.unlink.bind(fs),pending=path.join(f.root,'delivery-handoff.json');
 const spy=vi.spyOn(fs,'unlink').mockImplementation(async file=>{if(String(file)===pending)throw new Error('rollback cleanup failure');return unlink(file);});
 await expect(rollbackDeliveryHandoff(f.root,f.resources,()=>{})).rejects.toThrow('rollback cleanup failure');spy.mockRestore();
 expect(await rollbackDeliveryHandoff(f.root,f.resources,()=>{})).toBe('rolled-back');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.resources,f.name),'utf8')).toBe(f.held);
},50000);
it.skipIf(process.platform!=='win32').each(['prepared','resource-moved','global-moved'])('recovers actual forced-crash handoff at %s with stale native guards',async stage=>{
 const f=await fixture(),payload=path.join(f.root,'audit-input.json'),checkpoint=path.join(f.root,'crash-ready');await fs.writeFile(payload,JSON.stringify(f.audit));
 const script=`import fs from 'node:fs/promises';import {handoffRetainedDelivery} from ${JSON.stringify(pathToFileURL(path.resolve('server/deliveryHandoff.ts')).href)};const audit=JSON.parse(await fs.readFile(${JSON.stringify(payload)},'utf8'));await handoffRetainedDelivery(${JSON.stringify(f.root)},${JSON.stringify(f.resources)},audit,()=>{},async step=>{if(step===${JSON.stringify(stage)}){await fs.writeFile(${JSON.stringify(checkpoint)},'ready');setInterval(()=>{},1000);await new Promise(()=>{});}});`;
 const child=spawn(process.execPath,['--experimental-transform-types','--input-type=module','-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stdout.resume();child.stderr.on('data',data=>stderr+=data.toString());const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
 try{
  const deadline=Date.now()+10000;while(!await fs.stat(checkpoint).catch(()=>undefined)){if(child.exitCode!==null||Date.now()>deadline)throw new Error('Crash fixture failed: '+stderr);await new Promise(resolve=>setTimeout(resolve,40));}
  child.kill('SIGKILL');await closed;await new Promise(resolve=>setTimeout(resolve,200));
  await expect(acquireDeliveryLease(f.root)).rejects.toThrow();await expect(acquireResourceLease(f.resources,f.resource,'successor')).rejects.toThrow();
  expect(await rollbackDeliveryHandoff(f.root,f.resources,()=>{})).toBe('rolled-back');expect(await fs.readFile(path.join(f.root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.readFile(path.join(f.resources,f.name),'utf8')).toBe(f.held);expect(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')).toBe(f.bytes);
 }finally{child.kill('SIGKILL');await closed;}
},35000);