import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {expect,it} from 'vitest';
import {seedRetainedCloud,target} from './testFixtures/retainedCloud.ts';
import {bindNativeHandoffFixture} from './testFixtures/nativeHandoff.ts';
import {initializeNativeEpoch,journalNativeCommand} from './nativeCommandJournal.ts';
import {reconcileRetainedCloudHistory} from './retainedCloudRecovery.ts';
import {handoffRetainedDelivery} from './deliveryHandoff.ts';
import {digest} from './pinnedPreparation.ts';
import {collectPinnedPreparation,readPinnedBlob} from './pinnedPreparation.ts';
import {writePinnedSource} from './testFixtures/pinnedArtifact.ts';
import {journalPinnedPreparation} from './nativeCommandJournal.ts';
import {nativeEnvironment} from './pinnedPreparationContracts.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
it.skipIf(process.platform!=='win32')('requires a pinned preparation receipt even when all actual native intents have terminal proofs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-handoff-independent-'));
 try{
  const f=await seedRetainedCloud(root,state=>{const release=state.releases[0];release.plan.preparation={kind:'pinned-artifact-v1',sourceCommit:release.head,manifestSha256:'d'.repeat(64)};release.planHash=digest(JSON.stringify({plan:release.plan,head:release.head,environmentUrl:release.environmentUrl}));});
  const command={executable:'git',args:['rev-parse','HEAD']};const leaseHash=await bindNativeHandoffFixture(root,f,command);await initializeNativeEpoch(root,leaseHash);
  await journalNativeCommand(root,leaseHash,command,root,'run',async()=>{},async context=>{await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:context.id,intentSha256:context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));});
  const audit=await reconcileRetainedCloudHistory(root,f.input,{verifyTarget:async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:target.environmentUrl,...target.binding,...target.identity}),importJob:async()=>f.row},()=>{});
  expect(audit.nativeCommands.nativeTreeQuiescenceVerified).toBe(true);
  await expect(handoffRetainedDelivery(root,path.join(root,'resource-leases'),audit,()=>{})).rejects.toThrow('exactly one attributable preparation');
  expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(f.lease);expect(await fs.stat(path.join(root,'delivery-handoff.json')).catch(()=>undefined)).toBeUndefined();
 }finally{await fs.rm(root,{recursive:true,force:true});}
},20000);
it.skipIf(process.platform!=='win32').each(['valid','commit','manifest','checkout','unknown-run','duplicate'])('binds retained local preparation to exact approved run: %s',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-binding-independent-'));
 try{
  const source=path.join(root,'source'),data=await writePinnedSource(source,'synthetic/repo',target);
  const f=await seedRetainedCloud(root,state=>{const release=state.releases[0];release.head=data.head;state.runs[0].head=data.head;release.plan.preparation={...data.plan.preparation};if(mode==='commit'){release.head='b'.repeat(40);state.runs[0].head=release.head;release.plan.preparation.sourceCommit=release.head;}if(mode==='manifest')release.plan.preparation.manifestSha256='f'.repeat(64);release.planHash=digest(JSON.stringify({plan:release.plan,head:release.head,environmentUrl:release.environmentUrl}));});
  const command={executable:'git',args:['rev-parse','HEAD']},leaseHash=await bindNativeHandoffFixture(root,f,command);await initializeNativeEpoch(root,leaseHash);
  await journalNativeCommand(root,leaseHash,command,root,'run',async()=>{},async context=>{await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:context.id,intentSha256:context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));});
  const read=(file:string)=>readPinnedBlob(async args=>(await promisify(execFile)('git',args,{cwd:source,env:nativeEnvironment(process.env,args,'git'),windowsHide:true})).stdout,data.head,file);
  const checkout=path.join(root,'delivery-runs','run',mode==='checkout'?'other-checkout':'checkout');await fs.mkdir(path.dirname(checkout),{recursive:true});
  const collected=await collectPinnedPreparation(data.plan.preparation,await read('cubefarm.delivery.json'),data.manifest,checkout,read);
  await journalPinnedPreparation(root,leaseHash,mode==='unknown-run'?'foreign-run':'run',collected.plan,collected.buffers,async()=>{});
  if(mode==='duplicate'){await fs.rm(checkout,{recursive:true,force:true});await journalPinnedPreparation(root,leaseHash,'run',collected.plan,collected.buffers,async()=>{});}
  const audit=await reconcileRetainedCloudHistory(root,f.input,{verifyTarget:async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:target.environmentUrl,...target.binding,...target.identity}),importJob:async()=>f.row},()=>{});
  expect(audit.nativeCommands.nativeTreeQuiescenceVerified).toBe(true);
  if(mode==='valid')await expect(handoffRetainedDelivery(root,path.join(root,'resource-leases'),audit,()=>{})).resolves.toMatchObject({maintenanceRequired:true,deploymentOutcomeVerified:false});
  else{await expect(handoffRetainedDelivery(root,path.join(root,'resource-leases'),audit,()=>{})).rejects.toThrow(mode==='duplicate'?'exactly one attributable':'Local preparation differs');expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(f.lease);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
},30000);
