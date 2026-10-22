import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite,SerialWriter} from './atomicFile.ts';
import {readBoundedJson} from './boundedJson.ts';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {acquireResourceLease} from './resourceLease.ts';
import {canvasResource} from './canvasOwnership.ts';
import {HttpError} from './httpError.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
export class PackagingProviderError extends Error {
 constructor(readonly status:number,readonly requestId?:string,readonly providerCode?:string){super(`Power Apps packaging returned HTTP ${status}; no retry`);this.name='PackagingProviderError';}
}
export function assertPackagingResponse(response:Pick<Response,'ok'|'status'|'headers'>,text:string){
 if(response.ok)return;
 const rawId=response.headers.get('x-ms-request-id')??response.headers.get('x-ms-correlation-request-id'),requestId=rawId&&/^[A-Za-z0-9-]{1,100}$/.test(rawId)?rawId:undefined;
 let providerCode:string|undefined;try{const value=parseUnambiguousJson(text,{maxBytes:2*1024*1024}) as any;if(typeof value?.error?.code==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value.error.code))providerCode=value.error.code;}catch{/* Retain status without retaining provider messages or non-JSON bodies. */}
 throw new PackagingProviderError(response.status,requestId,providerCode);
}
/** Error responses retain their known status even when their optional body is unreadable. */
export async function readPackagingResponse(response:Response,guard:()=>void=()=>{}){
 const chunks:Uint8Array[]=[];let count=0;const reader=response.body?.getReader();
 try{
  if(reader)try{for(;;){const part=await reader.read();guard();if(part.done)break;count+=part.value.length;if(count>2*1024*1024)throw Error('Power Apps packaging response exceeds bound');chunks.push(part.value);}}finally{await reader.cancel();}
  guard();
 }catch(error){assertPackagingResponse(response,'');throw error;}
 const text=Buffer.concat(chunks).toString('utf8');assertPackagingResponse(response,text);
 return text?parseUnambiguousJson(text,{maxBytes:2*1024*1024}):null;
}
export const packagingPlan=z.strictObject({schemaVersion:z.literal(1),appId:z.uuid(),environmentId:z.string().regex(/^(?:Default-)?[a-f0-9-]{36}$/i),solutionName:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{2,99}$/),displayName:z.string().min(1).max(100),publisherId:z.uuid(),publisherPrefix:z.string().regex(/^[a-z][a-z0-9]{1,7}$/)});
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decision=z.strictObject({proposalSha256:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','rejected']),notes:z.string().min(80).max(8000)});
export const packagingReviewRequest=z.discriminatedUnion('action',[z.strictObject({action:z.literal('inspect')}),z.strictObject({action:z.literal('inspect-recovery')}),decision.extend({action:z.literal('review')}),decision.extend({action:z.literal('review-recovery')})]);
export interface PackagingInputs {record:DeliveryRecord;plan:unknown;environmentUrl:string;implementationSha256:string;configurationSha256:string;implementationSources?:{file:string;sha256:string;source:string}[]}
export interface PackagingTransport {
 inspect():Promise<{appId:string;environmentId:string;publisherId:string;publisherPrefix:string;existingSolutions:unknown[];canvasRows:unknown[]}>;
 createSolution(id:string,marker:string):Promise<void>;
 makeSolutionAware(solutionId:string):Promise<void>;
 verify(solutionId:string,marker:string):Promise<{canvasId:string;playId:string;logicalName:string;solutionId:string}>;
 exportSolution(solutionId:string):Promise<{file:string;sha256:string;bytes:number}>;
}
/** A scoped preparation operation: no screen changes, publication, imports or
 * global design/task approval. Unknown remote outcomes are never retried. */
export class CanvasPackaging {
 private serial=new SerialWriter();
 constructor(private root:string,private leaseRoot:string,private inputs:()=>Promise<PackagingInputs>,private connect:(input:PackagingInputs)=>Promise<PackagingTransport>){}
 private file(repo:string,kind:string){return path.join(this.root,'planning','canvas-packaging',hash(repo)+'.'+kind+'.json');}
 async proposal(guard:()=>void=()=>{}){
  guard();const input=await this.inputs();guard();const plan=packagingPlan.parse(input.plan),record=input.record;
  if(!record.content.sourceCommit||new URL(input.environmentUrl).origin!==new URL(record.content.environmentUrl!).origin||!record.content.taskPlan?.tasks.some(t=>t.resources.includes('canvas_'+plan.appId)&&t.owner!==record.content.qaOwner))throw Error('Packaging requires the exact pinned app task and target');
  for(const value of [input.implementationSha256,input.configurationSha256])if(!/^[a-f0-9]{64}$/.test(value))throw Error('Packaging implementation/configuration digest required');
  const proposal={scope:'same-app-solution-packaging-only',record:recordReference(record),repoId:record.repoId,owner:record.content.owner,qaOwner:record.content.qaOwner,sourceCommit:record.content.sourceCommit,environmentUrl:input.environmentUrl,plan,implementationSha256:input.implementationSha256,configurationSha256:input.configurationSha256,operations:['create-new-dedicated-solution','make-existing-app-solution-aware','verify-same-play-id-and-membership','export-unmanaged-solution'],limits:['No force lease, app clone, screen editing, publish, import, flow changes, DLP or permission changes','No global architecture/task/release approval; normal approvals and runtime evidence remain required','Any interrupted/failed dispatch retains intent and lease; no retry, adoption, rollback or deletion']};
  return {proposal,proposalSha256:hash(proposal)};
 }
 async inspect(guard:()=>void=()=>{}){const view=await this.proposal(guard),input=await this.inputs();return {...view,implementationSources:input.implementationSources??[],review:await readBoundedJson(this.file(view.proposal.repoId,'review'),16384)??null,journal:await readBoundedJson(this.file(view.proposal.repoId,'journal'),65536)??null};}
 async review(raw:unknown,actor:{id:string;role:string},guard:()=>void=()=>{}){return this.serial.write(async()=>{
  const data=decision.parse(raw),view=await this.proposal(guard);
  if(actor.role!=='qa'||actor.id!==view.proposal.qaOwner||actor.id===view.proposal.owner)throw Error('Assigned independent packaging reviewer required');
  if(data.proposalSha256!==view.proposalSha256)throw Error('Packaging proposal changed');
  const review={...data,reviewer:actor.id,reviewedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*60*1000).toISOString()};
  guard();await atomicWrite(this.file(view.proposal.repoId,'review'),JSON.stringify(review),()=>{guard();return true;});return review;
 });}
 async execute(expected:string,guard:()=>void=()=>{}){return this.serial.write(async()=>{
  const view=await this.inspect(guard),review=z.object({proposalSha256:z.literal(expected),decision:z.literal('approved'),reviewer:z.literal(view.proposal.qaOwner),expiresAt:z.iso.datetime()}).parse(view.review);
  if(expected!==view.proposalSha256||Date.parse(review.expiresAt)<=Date.now())throw Error('Fresh exact independent packaging approval required');
  if(view.journal)throw Error('Packaging history exists; preserve and reconcile it without retrying');
  const authorize=async()=>{guard();const current=await this.proposal(guard),saved=await readBoundedJson(this.file(view.proposal.repoId,'review'),16384);if(current.proposalSha256!==expected||JSON.stringify(saved)!==JSON.stringify(view.review)||Date.parse(review.expiresAt)<=Date.now())throw Error('Packaging authority changed');};await authorize();
  const lease=await acquireResourceLease(this.leaseRoot,canvasResource(view.proposal.environmentUrl,view.proposal.plan.appId),JSON.stringify({scope:'canvas-packaging',repoId:view.proposal.repoId,proposalSha256:expected}),{reclaimDeadOwner:false});
  let dispatched=false;
  const journal:any={schemaVersion:1,scope:view.proposal.scope,proposalSha256:expected,record:view.proposal.record,appId:view.proposal.plan.appId,solutionId:crypto.randomUUID(),marker:'CubeFarmPackaging:'+expected,phase:'prepared',startedAt:new Date().toISOString(),operations:[]};
  const persist=async()=>{await lease.assertOwned();await atomicWrite(this.file(view.proposal.repoId,'journal'),JSON.stringify(journal));};
  try{
   const transport=await this.connect(await this.inputs());await authorize();await lease.assertOwned();const before=await transport.inspect();await authorize();
   const p=view.proposal.plan;if(before.appId.toLowerCase()!==p.appId.toLowerCase()||before.environmentId.toLowerCase()!==p.environmentId.toLowerCase()||before.publisherId.toLowerCase()!==p.publisherId.toLowerCase()||before.publisherPrefix!==p.publisherPrefix||before.existingSolutions.length||before.canvasRows.length)throw Error('Packaging precondition differs: exact standalone app, publisher and absent solution required');
   journal.before=before;await persist();
   for(const [operation,call] of [['create-new-solution',()=>transport.createSolution(journal.solutionId,journal.marker)],['make-same-app-solution-aware',()=>transport.makeSolutionAware(journal.solutionId)]] as const){
    await authorize();await lease.assertOwned();journal.phase=operation;journal.operations.push({operation,status:'intent',at:new Date().toISOString()});await persist();dispatched=true;
    await call();await authorize();journal.operations.at(-1).status='returned';await persist();
   }
   journal.phase='verify-membership';journal.mapping=await transport.verify(journal.solutionId,journal.marker);await authorize();
   if(journal.mapping.playId.toLowerCase()!==p.appId.toLowerCase()||journal.mapping.solutionId.toLowerCase()!==journal.solutionId.toLowerCase()||!z.uuid().safeParse(journal.mapping.canvasId).success||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(journal.mapping.logicalName))throw Error('Packaged app identity differs');
   journal.phase='export';await persist();journal.archive=await transport.exportSolution(journal.solutionId);await authorize();
   if(!/^[a-f0-9]{64}$/.test(journal.archive.sha256)||journal.archive.bytes<4)throw Error('Actual solution export required');
   journal.phase='complete';journal.completedAt=new Date().toISOString();await persist();await lease.release();return journal;
  }catch(error){if(dispatched){journal.phase='blocked';journal.error='Remote packaging outcome requires reconciliation; do not retry';if(error instanceof PackagingProviderError)journal.providerFailure={httpStatus:error.status,requestId:error.requestId,providerCode:error.providerCode,retryAuthorized:false};await persist();}else await lease.release();if(error instanceof PackagingProviderError)throw new HttpError(409,`Canvas packaging stopped after Power Apps HTTP ${error.status}. Inspect the retained operation evidence before continuing; no retry was performed.`);throw error;}
 });}
}
