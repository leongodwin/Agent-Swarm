import {validateSharepointHistoryCheckpoint} from './sharepointProviderHistory.ts';
import path from 'node:path';
import {z} from 'zod';
import {inspectNativeEpoch} from './nativeCommandJournal.ts';
import {inspectNativeCapture,nativeCaptureBindingSchema,nativeCaptureReceiptSchema} from './nativeHistoryCapture.ts';
import {readBoundedJson} from './boundedJson.ts';
import {claimHash,type NativeClaim} from './nativeClaimReconciliation.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
/** Original epoch + prospective call-chain evidence. Never a PID/liveness check,
 * and never proof that an accepted/ambiguous remote operation has terminated. */
export async function inspectNativeClaimTermination(root:string,captureRoot:string,claim:NativeClaim,run:DeliveryRun,knownRuns:DeliveryRun[]){
 const missing={scope:'original-native-attempt',localTreeVerified:false,captureVerified:false,rejectedRequestSettled:false,remoteEffectsVerified:false,retryAuthorized:false};
 if(run.id!==claim.context.runId||run.releaseId!==claim.context.releaseId||run.head!==claim.context.sourceCommit||run.environmentUrl!==claim.context.environmentUrl||run.startedAt!==claim.context.startedAt)throw new Error('Original native termination run differs');
 if(!run.nativeLeaseSha256)return{...missing,reason:'Original native epoch is missing; it cannot be reconstructed from a dead PID'};
 z.string().regex(/^[a-f0-9]{64}$/).parse(run.nativeLeaseSha256);
 const native=await inspectNativeEpoch(root,run.nativeLeaseSha256);if(!native.nativeTreeQuiescenceVerified||!('commandBindings'in native)||!native.commandBindings?.some(c=>c.runId===run.id)||native.commandBindings.some(c=>!(c.runId===undefined&&c.readOnly)&&!knownRuns.some(r=>r.id===c.runId&&r.nativeLeaseSha256===run.nativeLeaseSha256)))return{...missing,reason:'Original epoch lacks complete attributable process-tree proof'};
 const directory=path.join(captureRoot,claim.attemptId),raw=await readBoundedJson(path.join(directory,'seal.json'),16384);if(!raw)return{...missing,localTreeVerified:true,reason:'Original attempt lacks a sealed prospective capture'};
 const binding=nativeCaptureBindingSchema.parse(await readBoundedJson(path.join(directory,'binding.json'),16384)),receipt=nativeCaptureReceiptSchema.parse(raw);
 if(binding.id!==claim.attemptId||binding.leaseSha256!==run.nativeLeaseSha256||JSON.stringify(binding.context)!==JSON.stringify(claim.context)||binding.contractHash!==claim.contractHash||binding.targetSha256!==claim.check.targetSha256||binding.correlationKey!==claim.correlationKey)throw new Error('Original native capture binding differs');
 const capture=await inspectNativeCapture(captureRoot,receipt,binding),intents=capture.events.filter(e=>e.kind==='attempt-intent'),responses=capture.events.filter(e=>e.kind==='attempt-response'),response=responses[0]?.data;
 const settled=intents.length===1&&responses.length===1&&intents[0].sequence<responses[0].sequence&&capture.events.at(-1)?.kind==='cleanup'&&capture.events.at(-1)?.data.verified===true&&response?.status===403&&response.targetSha256===claim.check.targetSha256&&response.subject===claim.check.deniedSubject&&response.correlationKey===claim.correlationKey&&capture.events.some(e=>e.kind==='claim'&&e.sequence<intents[0].sequence&&e.data.claimSha256===claimHash(claim));
 const checkpoints=capture.events.filter(e=>e.kind==='provider-checkpoint');
 let historyCheckpoint:ReturnType<typeof validateSharepointHistoryCheckpoint>|undefined;
 if(checkpoints.length){
  if(checkpoints.length!==1||intents.length!==1||checkpoints[0].sequence>=(capture.events.find(e=>e.kind==='claim')?.sequence??-1)||checkpoints[0].sequence>=intents[0].sequence||Date.parse(checkpoints[0].observedAt)>Date.parse(claim.observedAt))throw Error('Original provider checkpoint lifecycle differs');
  historyCheckpoint=validateSharepointHistoryCheckpoint(checkpoints[0].data.checkpoint,claim.check,claim.context.startedAt);
  if(Date.parse(historyCheckpoint.capturedAt)>Date.parse(checkpoints[0].observedAt))throw Error('Original provider checkpoint was captured after publication');
 }
 // A second pass detects an epoch change during capture inspection.
 const after=await inspectNativeEpoch(root,run.nativeLeaseSha256);if(!after.nativeTreeQuiescenceVerified||!('journalSha256'in after)||after.journalSha256!==native.journalSha256)throw new Error('Original native epoch changed during inspection');
 return{...missing,...(historyCheckpoint?{historyCheckpoint}:{}),localTreeVerified:true,captureVerified:true,rejectedRequestSettled:settled,journalSha256:native.journalSha256,captureSha256:claimHash(receipt),reason:settled?'Owned call chain closed after an attributable rejected request; complete remote history is still required':'Original HTTP request is accepted, ambiguous or lacks attributable cleanup'};
}
