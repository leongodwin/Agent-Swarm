import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {DeliveryRelease} from '../shared/delivery.ts';
import {inspectNativeClaim,authorizeNativeSuccessor,claimHash,nativeClaimKey,type NativeClaim} from './nativeClaimReconciliation.ts';
import {nativeIdentityClientMatches,nativeSnapshotSchema,nativeObservedIdentitySchema,nativeCompleteCapabilitiesSchema,type NativeDeniedFactory} from './nativeDeniedAccess.ts';
import {sharepointHistoryCheckpointSchema} from './sharepointProviderHistory.ts';
export const nativeClaimRequestSchema=z.strictObject({action:z.enum(['inspect','authorize-successor']),releaseId:z.uuid(),planHash:z.string().regex(/^[a-f0-9]{64}$/),logicalKey:z.string().regex(/^[a-f0-9]{64}$/),expectedClaimSha256:z.string().regex(/^[a-f0-9]{64}$/),testName:z.string().min(1).max(200)});
export interface NativeClaimSessionAuthority{repoId:string;reviewer:string;release:DeliveryRelease;claimRoot:string;evidenceRoot:string;cwd:string;connect:NativeDeniedFactory;signal:AbortSignal;guard:()=>Promise<void>;verifyPreviousRun:(claim:NativeClaim)=>Promise<unknown>}
/** Authority is captured by the office session. Arguments never supply a role,
 * proof, adapter, path, observer identity or signing key. */
export async function reconcileNativeClaimSession(input:unknown,a:NativeClaimSessionAuthority){
 const request=nativeClaimRequestSchema.parse(input),release=a.release;
 const guard=async()=>{a.signal.throwIfAborted();await a.guard();a.signal.throwIfAborted();if(release.repoId!==a.repoId||release.id!==request.releaseId||release.planHash!==request.planHash||release.plan.qaOwner!==a.reviewer||release.plan.owner===a.reviewer)throw new Error('Assigned independent QA session and exact release are required');};
 await guard();const head=await inspectNativeClaim(a.claimRoot,request.logicalKey);await guard();
 const check=release.plan.verification.nativeDeniedChecks?.find(c=>c.testName===request.testName);
 if(!check||nativeClaimKey(check)!==request.logicalKey||head.sha256!==request.expectedClaimSha256||head.claim.context.environmentUrl!==release.environmentUrl)throw new Error('Native claim/target/release binding differs');
 // The caller cannot choose which historical attempt the server observes.
 const termination=await a.verifyPreviousRun(head.claim);await guard();
 const historyCheckpoint=head.claim.check.target?z.object({historyCheckpoint:sharepointHistoryCheckpointSchema}).parse(termination).historyCheckpoint:undefined;
 const inspect=async()=>{
  let adapter:Awaited<ReturnType<NativeDeniedFactory>>|undefined;
  try{adapter=await a.connect(head.claim.check,a.signal,{phase:'reconciliation',context:head.claim.context,cwd:a.cwd,owned:guard,historyCheckpoint});await guard();
   const observer=nativeObservedIdentitySchema.parse(await adapter.identity('observer'));await guard();const c=head.claim.check;
   if(!nativeIdentityClientMatches(c,'observer',observer)||observer.tenantId.toLowerCase()!==c.tenantId.toLowerCase()||observer.subject.toLowerCase()!==c.observerSubject.toLowerCase()||observer.username.toLowerCase()!==c.observerUsername.toLowerCase()||observer.targetSha256!==c.targetSha256)throw new Error('Authenticated historical observer differs');
   const caps=await adapter.capabilities();await guard();const observed=await adapter.observe(head.claim.correlationKey);await guard();await adapter.close();adapter=undefined;await guard();
   const evidence={schemaVersion:1,claimSha256:head.sha256,logicalKey:request.logicalKey,reviewer:a.reviewer,releaseId:release.id,planHash:release.planHash,observedAt:new Date().toISOString(),observer,capabilities:caps,observation:observed,cleanupVerified:true};
   const bytes=JSON.stringify(evidence);if(Buffer.byteLength(bytes)>2*1024*1024)throw new Error('Native history evidence oversized');
   await fs.mkdir(a.evidenceRoot,{recursive:true});await guard();const name=`native-reconciliation-${crypto.randomUUID()}.json`,file=path.join(a.evidenceRoot,name),handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await guard();
   return{caps,observed,evidenceFile:name,evidenceSha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  }finally{await adapter?.close();}
 };
 if(request.action==='inspect'){const result=await inspect();return{status:'observed-unreviewed',claimSha256:head.sha256,retryAuthorized:false,termination,...result};}
 if(!release.approvedAt||release.approvedBy!==a.reviewer||!release.plan.deliveryRecord)throw new Error('New independently approved release and current delivery record required');
 const result=await authorizeNativeSuccessor(a.claimRoot,request.logicalKey,request.expectedClaimSha256,{reviewer:a.reviewer,qaOwner:release.plan.qaOwner,author:release.plan.owner,newApproval:{releaseId:release.id,planHash:release.planHash,recordSha256:release.plan.deliveryRecord.sha256,sourceCommit:release.head,environmentUrl:release.environmentUrl},newCheckSha256:claimHash(check)},async()=>{
  const read=await inspect();await a.verifyPreviousRun(head.claim);await guard();nativeCompleteCapabilitiesSchema.parse(read.caps);const observed=nativeSnapshotSchema.parse(read.observed);await guard();
  if(observed.targetSha256!==head.claim.check.targetSha256||observed.correlationKey!==head.claim.correlationKey||Date.parse(observed.from)>Date.parse(head.claim.observedAt)||Date.parse(observed.from)>Date.parse(observed.through)||observed.writes.length||observed.dispatches.length)throw new Error('Complete historical no-effect proof unavailable');
  return{targetSha256:observed.targetSha256,correlationKey:observed.correlationKey,from:observed.from,through:observed.through,complete:true,authenticatedObserver:true,cleanupVerified:true,writes:[],dispatches:[],evidenceSha256:read.evidenceSha256};
 },guard);await guard();return{status:'authorized-successor-once',retryAuthorized:true,authorizationSha256:claimHash(result),expiresAt:result.expiresAt};
}
