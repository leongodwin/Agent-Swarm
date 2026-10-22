import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './atomicFile.ts';
import {taskScopeHash} from './taskScope.ts';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {executionPhases,type ExecutionPhase,type ExecutionEvidenceContract} from '../shared/executionEvidence.ts';

const digest=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface ExecutionObservation {passed:boolean;observedAt:string;expiresAt:string;sourceSha256:string;sourceReference?:string;details?:unknown;}
export interface ExecutionAttempt {phase:ExecutionPhase;actor:string;attemptId:string;issue?:number;}
export interface ExecutionAdmissionDependencies {
 configuration(record:DeliveryRecord):{sha256:string;identity:unknown};
 observe(probe:ExecutionEvidenceContract['probe'],record:DeliveryRecord,attempt:ExecutionAttempt,guard:()=>void):Promise<ExecutionObservation>;
}
/** No caller/MCP supplied receipts. Only trusted fixed observers can publish
 * grants, and every reuse is byte-checked under the current owned scope. */
export class ExecutionAdmission {
 private cache=new Map<string,{file:string;sha256:string;expiresAt:number;observedAt:number;monotonicDeadline:number;text:string}>();
 constructor(private root:string,private deps:ExecutionAdmissionDependencies){}
 view(){return{scope:'server-owned-execution-receipt-snapshots',limits:['Historical metadata snapshots, not new observations or approvals; original receipt bytes are checked before every reuse'],receipts:[...this.cache.values()].slice(-8).map(r=>({reference:r.file,sha256:r.sha256,receipt:JSON.parse(r.text)}))};}
 async check(record:DeliveryRecord,attempt:ExecutionAttempt,guard:()=>void){
  guard();
  const findings=record.content.findings.filter(f=>f.executionEvidence);
  if(!findings.length)return;
  if(!executionPhases.includes(attempt.phase)||!attempt.actor||!attempt.attemptId)throw Error('Execution attempt identity/phase is missing');
  if(record.designReview?.decision!=='approved'||record.designReview.reviewer!==record.content.qaOwner)throw Error('Execution evidence requires independently approved design');
  if(attempt.phase==='authoring'){
   const task=record.content.taskPlan?.tasks.find(t=>t.issue===attempt.issue),review=record.taskReviews?.find(t=>t.issue===attempt.issue);
   if(!task||![task.owner,record.content.qaOwner].includes(attempt.actor)||review?.decision!=='approved'||review.reviewer!==record.content.qaOwner||review.taskHash!==taskScopeHash(record,attempt.issue!))throw Error('Execution evidence requires the current independently approved task');
  }
  const config=this.deps.configuration(record);
  if(findings.some(f=>f.executionEvidence!.configurationSha256!==config.sha256))throw Error('Execution probe configuration differs from approved contract');
  const binding={schemaVersion:1,record:recordReference(record),sourceCommit:record.content.sourceCommit,environmentUrl:record.content.environmentUrl,
   design:{docId:record.designReview.docId,artifactSha256:record.designReview.artifactSha256,reviewer:record.designReview.reviewer,sha256:digest(record.designReview)},taskHashes:record.content.taskPlan?.tasks.map(t=>({issue:t.issue,hash:taskScopeHash(record,t.issue)})),
   taskReviewsSha256:digest(record.taskReviews??[]),taskAcceptancesSha256:digest(record.taskAcceptances??[]),sliceReceiptSha256:digest(record.sliceReceipt??null),attempt,configuration:config,
   contracts:findings.map(f=>({findingId:f.id,contract:f.executionEvidence}))};
  const key=digest(binding),cached=this.cache.get(key),now=Date.now();
  if(cached&&cached.observedAt<=now&&cached.expiresAt>now+5000&&performance.now()+5000<cached.monotonicDeadline){
   const stat=await fs.lstat(cached.file);guard();
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(cached.file)!==cached.file)throw Error('Execution receipt storage changed');
   const bytes=await fs.readFile(cached.file);guard();
   if(bytes.length>65536||crypto.createHash('sha256').update(bytes).digest('hex')!==cached.sha256||Date.now()<cached.observedAt||Date.now()>=cached.expiresAt||performance.now()>=cached.monotonicDeadline)throw Error('Execution receipt changed or expired');
   return {sha256:cached.sha256,reference:cached.file};
  }
  const probes=[...new Set(findings.map(f=>f.executionEvidence!.probe))];
  const results=await Promise.allSettled(probes.map(async probe=>({probe,...await this.deps.observe(probe,record,attempt,guard)})));
  guard();
  const observations=results.map(result=>{if(result.status!=='fulfilled')throw Error('Execution observation failed; no operation admitted');return result.value;});
  const at=Date.now();
  if(observations.some(o=>o.passed!==true||!/^[a-f0-9]{64}$/.test(o.sourceSha256)||!Number.isFinite(Date.parse(o.observedAt))||!Number.isFinite(Date.parse(o.expiresAt))||Date.parse(o.observedAt)>at||Date.parse(o.expiresAt)<=at||Date.parse(o.expiresAt)-Date.parse(o.observedAt)>60000))throw Error('Execution prerequisites are adverse, expired or unverified');
  const observedAt=Math.min(...observations.map(o=>Date.parse(o.observedAt))),expiresAt=Math.min(...observations.map(o=>Date.parse(o.expiresAt)));
  const receipt={scope:'server-owned-phase-execution-admission',binding,observations,observedAt:new Date(observedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString(),limits:['Metadata admission only; no inference, effective DLP/privacy, quality or delivery success assurance']};
  const text=JSON.stringify(receipt);if(Buffer.byteLength(text)>65536)throw Error('Execution receipt exceeds its bound');
  const sha256=crypto.createHash('sha256').update(text).digest('hex'),directory=path.resolve(this.root,'execution-admission');
  await fs.mkdir(directory,{recursive:true});guard();
  if(await fs.realpath(directory)!==directory)throw Error('Execution receipt directory is linked');
  const file=path.join(directory,sha256+'.json');
  await atomicWrite(file,text,()=>{guard();if(Date.now()<observedAt||Date.now()>=expiresAt)throw Error('Execution evidence expired before publication');return true;});guard();
  if(Date.now()<observedAt||Date.now()>=expiresAt)throw Error('Execution evidence expired before admission');
  this.cache.set(key,{file,sha256,observedAt,expiresAt,monotonicDeadline:performance.now()+Math.max(0,expiresAt-Date.now()),text});
  return{reference:file,sha256};
 }
}
