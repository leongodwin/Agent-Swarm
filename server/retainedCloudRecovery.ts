import {observeProviderImport} from './providerImportHistory.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readDeliveryRecoverySnapshot} from './deliveryRecovery.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {validateDeliveryState} from './deliveryState.ts';
import {platformIdentitySchema} from './identityContracts.ts';
import {targetBindingSchema,dataverseGuid} from './targetOperations.ts';
import {inspectNativeCommands} from './nativeCommandJournal.ts';
import {inspectRetainedTargetLeases} from './targetLeaseReconciliation.ts';
import {HttpError} from './httpError.ts';
import {verifyTrackedImport,trackedImportCommand} from './trackedImport.ts';

const rootUrl=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash;});
export const retainedTargetSchema=z.strictObject({environmentUrl:rootUrl,binding:targetBindingSchema,identity:platformIdentitySchema});
export const retainedRecoverySchema=z.strictObject({snapshotSha256:z.string().regex(/^[a-f0-9]{64}$/),targets:z.array(retainedTargetSchema).max(10)});
export type RetainedTarget=z.infer<typeof retainedTargetSchema>;
export interface RetainedObserver {verifyTarget(target:RetainedTarget):Promise<unknown>;importJob(target:RetainedTarget,id:string):Promise<unknown>}
const identityReceiptSchema=z.object({scope:z.literal('dataverse-identity-observation'),checkedAt:z.iso.datetime({offset:true}),environmentUrl:rootUrl,...targetBindingSchema.shape,...platformIdentitySchema.shape});
const jobSchema=z.object({importjobid:dataverseGuid,solutionname:z.string().min(1),progress:z.literal(100),startedon:z.iso.datetime({offset:true}),completedon:z.iso.datetime({offset:true}),'@odata.nextLink':z.never().optional(),nextLink:z.never().optional()});
const canonical=(value:string)=>new URL(rootUrl.parse(value)).origin.toLowerCase();

/** Read-only terminality observations, never replay or certification of deployment.
 * Both original marker and state remain immutable until all checks pass. */
export async function reconcileRetainedCloudHistory(root:string,input:unknown,observer:RetainedObserver,assertOpen:()=>void,resourceLeaseRoot=path.join(root,'resource-leases')){
  const request=retainedRecoverySchema.parse(input);assertOpen();
  const guard=path.join(root,'delivery.lock.reaping');
  await fs.mkdir(guard).catch(()=>{throw new HttpError(409,'Delivery recovery or release is already in progress');});
  let targetInspection:Awaited<ReturnType<typeof inspectRetainedTargetLeases>>|undefined;
  try{
    const original=await readDeliveryRecoverySnapshot(root);assertOpen();
    if(!original.view.retainedInspectionAvailable||original.view.snapshotSha256!==request.snapshotSha256)throw new HttpError(409,'Retained recovery ownership or history changed');
    const unchanged=async()=>{assertOpen();const now=await readDeliveryRecoverySnapshot(root);assertOpen();if(!now.view.retainedInspectionAvailable||now.view.snapshotSha256!==request.snapshotSha256)throw new HttpError(409,'Retained recovery ownership or history changed');};
    await unchanged();
    const state=validateDeliveryState(parseUnambiguousJson(original.stateBytes!.toString('utf8'),{maxBytes:16*1024*1024}));
    if(state.attemptHistory?.attempts.some(attempt=>!attempt.runId))throw new HttpError(409,'Unlinked attempt requires independent native-operation reconciliation');
    const nativeCommands=await inspectNativeCommands(root,original.leaseBytes!);
    const oldOwner=z.object({pid:z.number()}).parse(parseUnambiguousJson(original.leaseBytes!.toString('utf8'),{maxBytes:16384}));
    targetInspection=await inspectRetainedTargetLeases(resourceLeaseRoot,oldOwner.pid,state.runs.map(run=>run.id));
    const targets=new Map(request.targets.map(target=>[canonical(target.environmentUrl),target]));
    if(targets.size!==request.targets.length)throw new HttpError(409,'Duplicate reconciliation targets');
    const jobs:{runId:string;id:string;commandSha256:string;platformJobId:string;solution:string;environment:string;startedAt:string}[]=[];
    for(const run of state.runs){
      const release=state.releases.find(item=>item.id===run.releaseId);
      if(!release?.approvedAt||release.repoId!==run.repoId||release.head!==run.head||canonical(release.environmentUrl)!==canonical(run.environmentUrl)||!state.policy||canonical(state.policy.environmentUrl)!==canonical(run.environmentUrl)||!run.solution||!run.recovery?.packageSha256||!run.operations?.length||!['import-started','imported'].includes(run.checkpoint??''))throw new HttpError(409,'Retained run lacks attributable approved import history');
      const ids=new Set<string>();
      const target=targets.get(canonical(run.environmentUrl)),binding=release.plan.verification.api?.binding;
      if(!target||!binding||target.binding.organizationId.toLowerCase()!==binding.organizationId.toLowerCase()||target.binding.userId.toLowerCase()!==binding.userId.toLowerCase())throw new HttpError(409,'Target identity differs from the immutable release binding');
      for(const operation of run.operations){
        if(operation.trackedImport){const tracked=await verifyTrackedImport(operation.trackedImport);if(tracked.platformJobId!==operation.platformJobId||tracked.packageSha256!==run.recovery.packageSha256||canonical(tracked.environmentUrl)!==canonical(run.environmentUrl)||crypto.createHash('sha256').update(JSON.stringify(trackedImportCommand(tracked))).digest('hex')!==operation.commandSha256)throw new HttpError(409,'Tracked import differs from the retained request binding');}
        if(ids.has(operation.id)||operation.kind!=='import'||operation.id!=='solution-import'||!dataverseGuid.safeParse(operation.platformJobId).success)throw new HttpError(409,'Unsupported or ambiguous retained cloud operation; inspect its native outcome');
        ids.add(operation.id);
        if(!targets.has(canonical(run.environmentUrl)))throw new HttpError(409,'Supply the approved identity for every retained target');
        jobs.push({runId:run.id,id:operation.id,commandSha256:operation.commandSha256,platformJobId:operation.platformJobId!,solution:run.solution,environment:canonical(run.environmentUrl),startedAt:operation.startedAt});
      }
    }
    if(jobs.length>50||new Set(jobs.map(job=>`${job.environment}:${job.platformJobId.toLowerCase()}`)).size!==jobs.length)throw new HttpError(409,'Retained import history exceeds its bound or reuses a job identity');
    if([...targets.keys()].some(target=>!jobs.some(job=>job.environment===target)))throw new HttpError(409,'Reconciliation includes an unrelated target');
    const observations:object[]=[],identityObservations:object[]=[],fingerprints=new Map<string,string>();
    const startedAt=Date.now();
    const verify=async(target:RetainedTarget,pass:number)=>{
      await unchanged();const evidence=identityReceiptSchema.parse(await observer.verifyTarget(target));await unchanged();
      if(canonical(evidence.environmentUrl)!==canonical(target.environmentUrl)||(['organizationId','userId'] as const).some(key=>evidence[key].toLowerCase()!==target.binding[key].toLowerCase())||(['tenantId','username','environmentId'] as const).some(key=>evidence[key].toLowerCase()!==target.identity[key].toLowerCase())||Date.parse(evidence.checkedAt)<startedAt||Date.parse(evidence.checkedAt)>Date.now())throw new HttpError(409,'Read-only identity observation differs from the approved target or freshness boundary');
      identityObservations.push({pass,...evidence});
    };
    for(let pass=1;pass<=2;pass++){
      for(const target of targets.values())await verify(target,pass);
      for(const job of jobs){
        await unchanged();const row=jobSchema.parse(await observeProviderImport(root,{snapshotSha256:request.snapshotSha256,runId:job.runId,commandSha256:job.commandSha256,platformJobId:job.platformJobId,environmentUrl:job.environment,solution:job.solution,startedAt:job.startedAt},()=>observer.importJob(targets.get(job.environment)!,job.platformJobId),unchanged));await unchanged();
        if(row.importjobid.toLowerCase()!==job.platformJobId.toLowerCase()||row.solutionname!==job.solution||Date.parse(row.startedon)<Date.parse(job.startedAt)||Date.parse(row.completedon)<Date.parse(row.startedon)||Date.parse(row.completedon)>Date.now())throw new HttpError(409,'Import terminal observation does not match the retained operation');
        const key=`${job.environment}:${job.platformJobId.toLowerCase()}`,fingerprint=JSON.stringify([row.importjobid.toLowerCase(),row.solutionname,row.progress,row.startedon,row.completedon]);
        if(pass===2&&fingerprints.get(key)!==fingerprint)throw new HttpError(409,'Import terminal observation changed between passes');
        fingerprints.set(key,fingerprint);
        observations.push({...job,pass,startedOn:row.startedon,completedOn:row.completedon,observedAt:new Date().toISOString(),progress:100,terminal:true});
      }
      for(const target of targets.values())await verify(target,pass);
    }
    const archive=path.join(root,'delivery-recovery');await fs.mkdir(archive,{recursive:true});if(!(await fs.lstat(archive)).isDirectory())throw new HttpError(409,'Recovery archive is not a regular directory');
    const id=crypto.randomUUID();const receipt={schemaVersion:1,id,scope:'retained-cloud-terminal-observations',at:new Date().toISOString(),snapshotSha256:request.snapshotSha256,stateSha256:crypto.createHash('sha256').update(original.stateBytes!).digest('hex'),nativeCommands,targetLeases:targetInspection.summary,nativeTreeQuiescenceVerified:nativeCommands.nativeTreeQuiescenceVerified,resumptionAuthorized:false,remoteTerminalityVerified:jobs.length>0,deploymentOutcomeVerified:false,releaseApproved:false,maintenanceRequired:true,resourceLeasesReleased:false,deliveryLeaseReleased:false,targets:request.targets,identityObservations,observations};
    await unchanged();
    await fs.writeFile(path.join(archive,`${id}.state.json`),original.stateBytes!,{flag:'wx',mode:0o600});
    await fs.writeFile(path.join(archive,`${id}.lock.json`),original.leaseBytes!,{flag:'wx',mode:0o600});
    const pending=path.join(archive,`${id}.pending`),file=await fs.open(pending,'wx',0o600);
    try{await file.writeFile(JSON.stringify(receipt));await file.sync();}finally{await file.close();}
    await unchanged();
    await targetInspection.assertUnchanged();
    if(JSON.stringify(await inspectNativeCommands(root,original.leaseBytes!))!==JSON.stringify(nativeCommands))throw new HttpError(409,'Native command observations changed');
    await unchanged();
    await fs.rename(pending,path.join(archive,`${id}.json`));
    return receipt;
  }finally{try{await targetInspection?.release();}finally{await fs.rmdir(guard);}}
}
