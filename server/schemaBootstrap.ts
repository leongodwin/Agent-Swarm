import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {atomicWrite,SerialWriter} from './atomicFile.ts';
import {readBoundedJson} from './boundedJson.ts';
import {sharepointHash,sharepointPlan} from './sharepointProvisioning.ts';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {taskScopeHash} from './taskScope.ts';
import {assertWriteTargetApproval} from './sharepointResourceApproval.ts';
import {assertDedicatedWriteTargets} from './sharepointWriteReadiness.ts';
import {SharepointProvisioning,type SharepointRequest} from './sharepointProvisioning.ts';
import {validateSchemaReconciliation,reconcileSchemaIntent,type SchemaReconciliationSpec} from './sharepointReconciliation.ts';
import {validateSchemaContinuation,continueAppliedSchema,type SchemaContinuationSpec} from './schemaContinuation.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const controlIds=['sharepoint-permissions','sharepoint-data-boundary','sharepoint-recovery'] as const;
const evidenceSchema=z.strictObject({id:z.enum(controlIds),reference:z.string().min(1),sha256:hash,observedAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
export const bootstrapEvidenceSchema=z.array(evidenceSchema).length(3).refine(rows=>new Set(rows.map(r=>r.id)).size===3&&rows.every(r=>Date.parse(r.expiresAt)>Date.parse(r.observedAt)));
const decisionSchema=z.strictObject({proposalSha256:hash,decision:z.enum(['approved','rejected']),notes:z.string().trim().min(80).max(8000)});
export const schemaBootstrapReviewRequest=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('inspect')}),decisionSchema.extend({action:z.literal('review')}),
]);
const savedSchema=decisionSchema.extend({reviewer:z.string().min(1),reviewedAt:z.iso.datetime(),expiresAt:z.iso.datetime()}).strict();
export type BootstrapInputs={record:DeliveryRecord;issue:number;plan:unknown;design:string;codeSha256:string;configurationSha256:string;evidence:unknown;historyScope?:'legacy-site'|'project';configurationEvidence?:unknown;reconciliation?:SchemaReconciliationSpec;continuation?:SchemaContinuationSpec};

/** A separate, expiring review of fixed schema creation. It grants no worker,
 * application design, task acceptance, content operation or release authority. */
export class SchemaBootstrap {
 private writer=new SerialWriter();
 constructor(private root:string,private inputs:()=>Promise<BootstrapInputs>){ }
 private file(repoId:string){return path.join(this.root,'planning','schema-bootstrap',sharepointHash(repoId)+'.json');}
 async proposal(guard:()=>void=()=>{}){
  guard();const input=await this.inputs();guard();const {record,issue}=input,plan=sharepointPlan.parse(input.plan),task=record.content.taskPlan?.tasks.find(t=>t.issue===issue),linked=record.content.tasks.find(t=>t.issue===issue);
  if(!record.content.sourceCommit||!task||linked?.stage!=='slice'||task.owner===record.content.qaOwner||task.dependsOn.length||!task.inputs.includes('sharepoint-plan-sha256:'+sharepointHash(plan))||plan.resources.some(r=>!task.resources.includes(r.key)))throw Error('Exact schema-bootstrap task, source and resource inputs required');
  if(input.design.length<100||Buffer.byteLength(input.design)>24*1024||!hash.safeParse(input.codeSha256).success||!hash.safeParse(input.configurationSha256).success)throw Error('Bounded pinned schema design and current implementation/configuration hashes required');
  if(input.reconciliation&&input.continuation)throw Error('Choose explicit migration or applied continuation, never both');
  if(input.reconciliation)validateSchemaReconciliation(input.reconciliation,plan,record.repoId,task.owner,issue,record);
  if(input.continuation)validateSchemaContinuation(input.continuation,plan,record.repoId,task.owner,issue,record);
  const evidence=bootstrapEvidenceSchema.parse(input.evidence),now=Date.now(),receipts=[];
  for(const e of evidence){
   guard();const real=await fs.realpath(e.reference),approved=await fs.realpath(path.join(this.root,'planning','evidence')),relative=path.relative(approved,real);
   if(approved!==path.resolve(this.root,'planning','evidence')||!path.isAbsolute(e.reference)||real!==path.resolve(e.reference)||relative.startsWith('..')||path.isAbsolute(relative)||Date.parse(e.observedAt)>now+60000||Date.parse(e.expiresAt)<=now)throw Error('Fresh exact local bootstrap evidence required');
   const stat=await fs.stat(real);if(!stat.isFile()||stat.size>32*1024)throw Error('Bootstrap evidence exceeds bound');
   const bytes=await fs.readFile(real);if(bytes.length>32*1024||sharepointHashBytes(bytes)!==e.sha256)throw Error('Bootstrap evidence digest changed');
   receipts.push({...e,text:new TextDecoder('utf8',{fatal:true}).decode(bytes)});
  }
  const proposal={schemaVersion:1 as const,scope:input.continuation?'continue-applied-schema-and-create':input.reconciliation?'reconcile-owned-schema-and-create':'create-schema-only',historyScope:input.historyScope??'legacy-site',repoId:record.repoId,record:recordReference(record),sourceCommit:record.content.sourceCommit,issue,owner:task.owner,qaOwner:record.content.qaOwner,taskHash:taskScopeHash(record,issue),task,plan,planSha256:sharepointHash(plan),design:input.design,codeSha256:input.codeSha256,configurationSha256:input.configurationSha256,configurationEvidence:input.configurationEvidence??null,controls:receipts,reconciliation:input.reconciliation??null,continuation:input.continuation??null,operations:input.continuation?['continue-applied-schema','create-schema']:input.reconciliation?['reconcile-owned-schema','create-schema']:['create-schema'],limits:['Only explicit evidence-bound first-parent reconciliation when its spec is present; never generic adoption or replay','No generic worker admission or global architecture/task/release approval','No folders, items, files, permissions, update, deletion, unknown-outcome retry or name-based adoption','New list and field IDs are verified outputs, not pre-creation inputs','Unknown outcomes retain durable history and lease for independent reconciliation','Project journals preserve completed foreign history under the shared site lease; unresolved foreign outcomes block; legacy handoff cannot target project journals']};
  guard();return {proposal,proposalSha256:sharepointHash(proposal)};
 }
 async view(guard:()=>void=()=>{}){const current=await this.proposal(guard);const review=await readBoundedJson(this.file(current.proposal.repoId),16*1024);guard();return {...current,review:review===undefined?null:savedSchema.parse(review)};}
 async review(input:unknown,actor:{id:string;role:string},guard:()=>void=()=>{}){
  return this.writer.write(async()=>{const data=decisionSchema.parse(input),current=await this.proposal(guard);
   if(actor.role!=='qa'||actor.id!==current.proposal.qaOwner||actor.id===current.proposal.owner)throw Error('Only assigned independent QA may review schema architecture/task');
   if(data.proposalSha256!==current.proposalSha256)throw Error('Schema-bootstrap proposal changed; inspect again');
   const now=Date.now(),expires=Math.min(now+60*60*1000,...current.proposal.controls.map(e=>Date.parse(e.expiresAt)));
   const review=savedSchema.parse({...data,reviewer:actor.id,reviewedAt:new Date(now).toISOString(),expiresAt:new Date(expires).toISOString()});
   guard();if((await this.proposal(guard)).proposalSha256!==current.proposalSha256)throw Error('Bootstrap inputs changed during review');
   await atomicWrite(this.file(current.proposal.repoId),JSON.stringify(review),()=>{guard();return true;});guard();return review;
  });
 }
 async authority(expected:string,guard:()=>void=()=>{}){
  const view=await this.view(guard),review=view.review;
  if(view.proposal.planSha256!==expected||!review||review.decision!=='approved'||review.proposalSha256!==view.proposalSha256||review.reviewer!==view.proposal.qaOwner||Date.parse(review.reviewedAt)>Date.now()+60000||Date.parse(review.expiresAt)<=Date.now())throw Error('Current independent schema architecture/task approval required');
  guard();return {historyScope:view.proposal.historyScope,continuation:view.proposal.continuation,reconciliation:view.proposal.reconciliation,repoId:view.proposal.repoId,plan:view.proposal.plan,record:view.proposal.record,issue:view.proposal.issue,owner:view.proposal.owner,authority:sharepointHash({scope:view.proposal.scope,proposalSha256:view.proposalSha256,review})};
 }
}
import crypto from 'node:crypto';
export const sharepointHashBytes=(bytes:Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');

export async function executeSchemaBootstrap(service:SchemaBootstrap,expected:string,context:{root:string;configurationRoot?:string;leaseRoot:string;repoId:string;binding:{tenantId:string;username:string};guard():void;connect():Promise<SharepointRequest&{readonly schemaWriteScopeObserved?:boolean}>}){
 let owned:Awaited<ReturnType<typeof assertWriteTargetApproval>>|undefined,bound:string|undefined;
 const authorize=async()=>{context.guard();const a=await service.authority(expected,context.guard),p=a.plan;
  if(a.repoId!==context.repoId||p.tenantId.toLowerCase()!==context.binding.tenantId.toLowerCase()||p.username.toLowerCase()!==context.binding.username.toLowerCase())throw Error('Bootstrap repository/target identity differs from configured writer');
  if(bound&&bound!==a.authority)throw Error('Bootstrap review changed during execution');bound=a.authority;
  await assertDedicatedWriteTargets(context.configurationRoot??context.root,context.repoId,p,context.guard);
  owned??=await assertWriteTargetApproval(context.configurationRoot??context.root,context.repoId,p,expected,context.guard,a.continuation?['continue-applied-schema','create-schema']:a.reconciliation?['reconcile-owned-schema','create-schema']:['create-schema']);await owned.owned();context.guard();return a;
 };
 const first=await authorize();
 const projectHistory=context.configurationRoot&&path.resolve(context.configurationRoot)!==path.resolve(context.root)?context.repoId:undefined;
 if((first.historyScope??'legacy-site')!==(projectHistory?'project':'legacy-site'))throw Error('Reviewed schema history scope differs from execution');
 if(projectHistory&&(first.reconciliation||first.continuation))throw Error('Project-scoped history requires an explicitly supported scoped recovery contract; legacy handoff is denied');
 const request=await context.connect();await authorize();
 if(request.schemaWriteScopeObserved!==true)throw Error('Bootstrap schema writer scope unverified; no lease or POST started');
 const authority=JSON.stringify({scope:'independently-reviewed-schema-bootstrap',repoId:context.repoId,record:first.record,sourceAuthority:first.authority,issue:first.issue,actor:first.owner,planSha256:expected});
 const continued=first.continuation?await continueAppliedSchema({root:context.root,leaseRoot:context.leaseRoot,repoId:context.repoId,owner:first.owner,issue:first.issue,record:first.record,plan:first.plan,spec:first.continuation,freshAuthority:authority,request,guard:context.guard,authorize:async()=>{await authorize();}}):undefined;
 const transferred=continued??(first.reconciliation?await reconcileSchemaIntent({root:context.root,leaseRoot:context.leaseRoot,repoId:context.repoId,owner:first.owner,issue:first.issue,record:first.record,plan:first.plan,spec:first.reconciliation,authority,request,guard:context.guard,authorize:async()=>{await authorize();}}):undefined);
 return new SharepointProvisioning(context.root,context.leaseRoot,projectHistory).execute(first.plan,continued?.authority??authority,request,context.guard,async()=>{await authorize();},transferred?.lease);
}
