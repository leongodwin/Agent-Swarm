import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {withHandoffMutex} from './handoffMutex.ts';
import {z} from 'zod';
import {readBoundedJson,readBoundedBytes} from './boundedJson.ts';
import {readDeliveryRecoverySnapshot} from './deliveryRecovery.ts';
import {inspectNativeCommands} from './nativeCommandJournal.ts';
import {inspectRetainedTargetLeases} from './targetLeaseReconciliation.ts';
import {validateDeliveryState} from './deliveryState.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
const sha=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const planSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),handoffPid:z.number().int().positive(),guardToken:z.uuid(),snapshotSha256:hash,stateSha256:hash,leaseSha256:hash,resourceRoot:z.string(),resources:z.array(z.strictObject({name:z.string().regex(/^[a-f0-9]{64}\.json$/),sha256:hash})).max(1000)});
async function durable(file:string,value:unknown){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}}
async function exists(file:string){return fs.lstat(file).then(stat=>{if(!stat.isFile())throw new Error('Nonregular handoff record');return true;},error=>{if(error.code==='ENOENT')return false;throw error;});}
async function exact(file:string,hash:string){if(!(await fs.lstat(file)).isFile()||sha((await readBoundedBytes(file,16*1024*1024))!)!==hash)throw new Error('Handoff ownership evidence changed');}
const auditSchema=z.object({id:z.uuid(),scope:z.literal('retained-cloud-terminal-observations'),snapshotSha256:hash,stateSha256:hash,at:z.iso.datetime(),remoteTerminalityVerified:z.literal(true),nativeCommands:z.object({journalSha256:hash,nativeTreeQuiescenceVerified:z.literal(true)}),targetLeases:z.object({leases:z.array(z.object({recordSha256:hash}))})});

/** Move exact old leases only after fresh terminal cloud observations and a
 * complete native epoch. Pending records fence both global and shared targets.
 * Crashes are reconciled by explicit rollback then a fresh observation pass. */
async function handoffRetainedDeliveryLocked(root:string,resourceRoot:string,audit:unknown,assertOpen:()=>void,step:(name:string)=>Promise<void>=async()=>{}){
 const evidence=auditSchema.parse(audit);assertOpen();
 const guard=path.join(root,'delivery.lock.reaping');await fs.mkdir(guard);
 let targets:Awaited<ReturnType<typeof inspectRetainedTargetLeases>>|undefined;
 try{
  if(await exists(path.join(root,'delivery-handoff.json')))throw new Error('Incomplete handoff must be reconciled first');
  const saved=await readBoundedJson(path.join(root,'delivery-recovery',evidence.id+'.json'),1024*1024);
  if(JSON.stringify(saved)!==JSON.stringify(audit)||Date.now()-Date.parse(evidence.at)>30000||Date.parse(evidence.at)>Date.now())throw new Error('Fresh internally published cloud observations required');
  const snapshot=await readDeliveryRecoverySnapshot(root);
  if(!snapshot.view.retainedInspectionAvailable||snapshot.view.snapshotSha256!==evidence.snapshotSha256||sha(snapshot.stateBytes!)!==evidence.stateSha256)throw new Error('Delivery snapshot changed');
  const native=await inspectNativeCommands(root,snapshot.leaseBytes!);
  if(!native.nativeTreeQuiescenceVerified||native.journalSha256!==evidence.nativeCommands.journalSha256)throw new Error('Complete native process-tree proof required');
  const state=validateDeliveryState(parseUnambiguousJson(snapshot.stateBytes!.toString('utf8'))),owner=z.object({pid:z.number()}).parse(parseUnambiguousJson(snapshot.leaseBytes!.toString('utf8')));
  if(state.runs.some(run=>run.nativeLeaseSha256!==sha(snapshot.leaseBytes!)||run.operations?.some(operation=>!native.commandBindings?.some(binding=>binding.runId===run.id&&binding.commandSha256===operation.commandSha256))))throw new Error('Retained operation belongs to a legacy, different or unattributable native epoch');
  for(const binding of native.commandBindings??[]){if(!binding.localPreparation)continue;const run=state.runs.find(run=>run.id===binding.runId),release=state.releases.find(release=>release.id===run?.releaseId);if(!run||binding.localPreparation.sourceCommit!==run.head||binding.localPreparation.manifestSha256!==release?.plan.preparation?.manifestSha256||binding.localPreparation.checkout!==path.join(root,'delivery-runs',run.id,'checkout'))throw new Error('Local preparation differs from the retained approved run');}
  for(const run of state.runs){const release=state.releases.find(release=>release.id===run.releaseId);if(release?.plan.preparation&&native.commandBindings?.filter(binding=>binding.runId===run.id&&binding.localPreparation).length!==1)throw new Error('Pinned run requires exactly one attributable preparation receipt');}
  await fs.mkdir(resourceRoot,{recursive:true});resourceRoot=await fs.realpath(resourceRoot);
  targets=await inspectRetainedTargetLeases(resourceRoot,owner.pid,state.runs.map(run=>run.id));
  if(JSON.stringify(targets.summary.leases.map(row=>row.recordSha256))!==JSON.stringify(evidence.targetLeases.leases.map(row=>row.recordSha256)))throw new Error('Target lease inventory differs from observed history');
  const id=crypto.randomUUID(),archive=path.join(root,'delivery-recovery',id);await fs.mkdir(archive);
  const plan=planSchema.parse({schemaVersion:1,id,handoffPid:process.pid,guardToken:crypto.randomUUID(),snapshotSha256:evidence.snapshotSha256,stateSha256:sha(snapshot.stateBytes!),leaseSha256:sha(snapshot.leaseBytes!),resourceRoot,resources:targets.records.map(row=>({name:row.name,sha256:sha(row.bytes)}))});
  await durable(path.join(archive,'plan.json'),plan);
  await fs.writeFile(path.join(archive,'state.json'),snapshot.stateBytes!,{flag:'wx'});
  // The pending plan is published before the first move. Never remove these
  // holds in a catch/finally: partial transactions require explicit recovery.
  await targets.assertUnchanged();
  const maintenance=path.join(root,'delivery-handoff-maintenance.json');
  if(!await exists(maintenance))await durable(maintenance,{schemaVersion:1,scope:'delivery-handoff-maintenance'});
  else z.strictObject({schemaVersion:z.literal(1),scope:z.literal('delivery-handoff-maintenance')}).parse(await readBoundedJson(maintenance,16384));
  await durable(path.join(guard,'handoff-owner.json'),{pid:process.pid,token:plan.guardToken});
  for(const record of plan.resources)await durable(path.join(resourceRoot,record.name+'.reaping','handoff-owner.json'),{pid:process.pid,token:plan.guardToken});
  await durable(path.join(root,'delivery-handoff.json'),plan);
  await durable(path.join(resourceRoot,'delivery-handoff.pending'),{schemaVersion:1,id,root:path.resolve(root)});
  assertOpen();
  // The inventory checker sees the deliberate shared-root fence from here on;
  // compare exact bytes individually under the already-held resource guards.
  await step('prepared');
  for(const record of plan.resources){assertOpen();await exact(path.join(resourceRoot,record.name),record.sha256);await fs.rename(path.join(resourceRoot,record.name),path.join(archive,record.name));await step('resource-moved');}
  assertOpen();await exact(path.join(root,'delivery.json'),plan.stateSha256);await exact(path.join(root,'delivery.lock'),plan.leaseSha256);
  const finalNative=await inspectNativeCommands(root,snapshot.leaseBytes!);if(!finalNative.nativeTreeQuiescenceVerified||finalNative.journalSha256!==native.journalSha256)throw new Error('Native epoch changed during handoff');
  await fs.rename(path.join(root,'delivery.lock'),path.join(archive,'delivery.lock'));await step('global-moved');
  await durable(path.join(archive,'committed.json'),{schemaVersion:1,id,scope:'lease-handoff',nativeTreeQuiescenceVerified:true,remoteTerminalityVerified:true,deploymentOutcomeVerified:false,maintenanceRequired:true});
  await fs.unlink(path.join(resourceRoot,'delivery-handoff.pending'));await fs.unlink(path.join(root,'delivery-handoff.json'));
  return {id,maintenanceRequired:true,deploymentOutcomeVerified:false};
 }finally{try{if(targets){for(const record of targets.records)await fs.unlink(path.join(resourceRoot,record.name+'.reaping','handoff-owner.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await targets.release();}}finally{await fs.unlink(path.join(guard,'handoff-owner.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.rmdir(guard);}}
}

/** Explicit rollback restores only missing exact old records. A foreign record,
 * missing archive, invalid sentinel or changed state leaves every hold intact. */
async function rollbackDeliveryHandoffLocked(root:string,resourceRoot:string,assertOpen:()=>void){
 const pending=path.join(root,'delivery-handoff.json'),guard=path.join(root,'delivery.lock.reaping'),guards:string[]=[];
 await reapHandoffGuard(root,guard);await fs.mkdir(guard);
 try{
  if(!await exists(pending))return false;
  const plan=planSchema.parse(await readBoundedJson(pending,1024*1024));resourceRoot=await fs.realpath(resourceRoot);
  if(resourceRoot!==plan.resourceRoot)throw new Error('Handoff resource root mismatch');
  const archive=path.join(root,'delivery-recovery',plan.id);
  await durable(path.join(guard,'handoff-owner.json'),{pid:process.pid,token:plan.guardToken});
  const sentinel=path.join(resourceRoot,'delivery-handoff.pending');
  const marker=await readBoundedJson(sentinel,16384);
  if(marker!==undefined&&JSON.stringify(marker)!==JSON.stringify({schemaVersion:1,id:plan.id,root:path.resolve(root)}))throw new Error('Foreign target handoff fence');
  await exact(path.join(root,'delivery.json'),plan.stateSha256);
  if(await exists(path.join(archive,'committed.json'))){const committed=z.object({id:z.literal(plan.id),scope:z.literal('lease-handoff'),nativeTreeQuiescenceVerified:z.literal(true),remoteTerminalityVerified:z.literal(true)}).parse(await readBoundedJson(path.join(archive,'committed.json'),16384));assertOpen();if(committed&&marker!==undefined)await fs.unlink(sentinel);await fs.unlink(pending);return 'committed' as const;}
  for(const record of plan.resources){const item=path.join(resourceRoot,record.name+'.reaping');await reapHandoffGuard(root,item);await fs.mkdir(item);guards.push(item);await durable(path.join(item,'handoff-owner.json'),{pid:process.pid,token:plan.guardToken});}
  const records=[...plan.resources.map(row=>({source:path.join(archive,row.name),target:path.join(resourceRoot,row.name),hash:row.sha256})),{source:path.join(archive,'delivery.lock'),target:path.join(root,'delivery.lock'),hash:plan.leaseSha256}];
  // Validate the entire rollback before restoring any record.
  for(const record of records){assertOpen();if(await exists(record.target))await exact(record.target,record.hash);else await exact(record.source,record.hash);}
  for(const record of records){assertOpen();if(!await exists(record.target))await fs.rename(record.source,record.target);}
  if(marker!==undefined)await fs.unlink(sentinel);
  const rolledBack=path.join(archive,'rolled-back.json');
  if(await exists(rolledBack))z.object({schemaVersion:z.literal(1),id:z.literal(plan.id),at:z.iso.datetime()}).parse(await readBoundedJson(rolledBack,16384));
  else await durable(rolledBack,{schemaVersion:1,id:plan.id,at:new Date().toISOString()});
  await fs.unlink(pending);return 'rolled-back' as const;
 }finally{try{for(const item of guards.reverse()){await fs.unlink(path.join(item,'handoff-owner.json'));await fs.rmdir(item);}}finally{await fs.unlink(path.join(guard,'handoff-owner.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.rmdir(guard);}}
}

async function reapHandoffGuard(root:string,guard:string){
 const present=await fs.lstat(guard).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});if(!present)return;
 if(!present.isDirectory())throw new Error('Invalid handoff guard');
 const plan=planSchema.parse(await readBoundedJson(path.join(root,'delivery-handoff.json'),1024*1024));
 const owner=z.strictObject({pid:z.number().int().positive(),token:z.uuid()}).parse(await readBoundedJson(path.join(guard,'handoff-owner.json'),16384));
 if(owner.token!==plan.guardToken)throw new Error('Foreign handoff guard');
 let absent=false;try{process.kill(owner.pid,0);}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH';}if(!absent)throw new Error('Handoff guard owner may still be active');
 // The kernel mutex excludes other handoff reapers. Ordinary acquisition cannot
 // remove or replace an existing recovery guard.
 await fs.rename(guard,path.join(root,'delivery-recovery',plan.id,'retired-guard-'+crypto.randomUUID()));
}
export async function handoffRetainedDelivery(...args:Parameters<typeof handoffRetainedDeliveryLocked>){return withHandoffMutex(args[0],check=>handoffRetainedDeliveryLocked(args[0],args[1],args[2],()=>{check();args[3]();},args[4]));}
export async function rollbackDeliveryHandoff(...args:Parameters<typeof rollbackDeliveryHandoffLocked>){return withHandoffMutex(args[0],check=>rollbackDeliveryHandoffLocked(args[0],args[1],()=>{check();args[2]();}));}
