import {assertQualityPlan} from './qualityEvidence.ts';
import {assertFirstSlicePlan,firstSliceContractHash} from './firstSlice.ts';
import crypto from 'node:crypto';
import {SerialWriter} from './atomicFile.ts';
import {DeliveryRecordStorage,recordSnapshotSchema} from './deliveryRecordStorage.ts';
import {HttpError} from './httpError.ts';
import {deliveryRecordSchema, deliveryRecordContentSchema, discoveryBlockers, recordReviewSchema,inputReviewSchema, preparationReceiptSchema, sliceReceiptSchema,taskReviewSchema,taskAcceptanceSchema,recordReference,type DeliveryRecord, type RecordReference} from '../shared/deliveryRecord.ts';
import {taskScope} from '../shared/taskPlan.ts';
import {taskScopeHash} from './taskScope.ts';
import {assertEvidenceOnlyRevision,assertOriginalTaskQa,type OriginalTaskQa} from './taskReconciliation.ts';
import {taskInputPrompt,taskPlanningBlockers,TASK_CONTEXT_BYTES} from './taskInputs.ts';
import type {DeliveryRelease, DeliveryRun} from '../shared/delivery.ts';

const stateSchema = recordSnapshotSchema;
export interface RecordContext {brief:string; environmentUrl?:string;tenantId?:string;executionEvidenceVersion?:1}
export function recordScopeMatches(record:Pick<DeliveryRecord,'content'>,context:RecordContext){
  return record.content.brief===context.brief&&record.content.environmentUrl?.replace(/\/$/,'').toLowerCase()===context.environmentUrl?.replace(/\/$/,'').toLowerCase();
}
const digest = (record: Pick<DeliveryRecord,'id'|'repoId'|'revision'|'previousSha256'|'content'>) => crypto.createHash('sha256').update(JSON.stringify({id:record.id,repoId:record.repoId,revision:record.revision,previousSha256:record.previousSha256,content:record.content})).digest('hex');
export class DeliveryRecords {
  private records: DeliveryRecord[] = [];
  private writer = new SerialWriter();
  private ready = false;
  private closed = false;
  private storage:DeliveryRecordStorage;
  constructor(home: string) {this.storage=new DeliveryRecordStorage(home);}
  async init() {
    this.ready=false;
    const state = {records:await this.storage.load()};
    const identities = new Set<string>();
    for (const record of state.records) {
      const key = `${record.repoId}:${record.revision}`;
      if (identities.has(key) || digest(record) !== record.sha256) throw new Error('Delivery record history is inconsistent; preserve it before repair');
      identities.add(key);
      const previous = state.records.find(row => row.repoId === record.repoId && row.revision === record.revision - 1);
      if (record.revision === 1 ? record.previousSha256 !== null : !previous || previous.id !== record.id || previous.sha256 !== record.previousSha256) throw new Error('Delivery record history has a missing or changed revision');
      if(record.designReview && record.designReview.reviewer !== record.content.qaOwner) throw new Error('Delivery record reviewer differs from its assigned QA owner');
      if(record.inputReview&&(record.inputReview.reviewer!==record.content.qaOwner||record.designReview||record.sliceReceipt||record.preparationReceipt||record.taskReviews?.length||record.taskAcceptances?.length))throw new Error('Missing-input rejection conflicts with independent approval provenance');
      if(record.sliceReceipt?.qualityAcceptance&&(record.sliceReceipt.qualityAcceptance.reviewer!==record.content.qaOwner||record.sliceReceipt.qualityAcceptance.evidenceHash!==record.sliceReceipt.evidenceHash))throw new Error('Slice quality acceptance differs from its independent review');
      if(record.preparationReceipt&&(record.preparationReceipt.recordSha256!==record.sha256||record.preparationReceipt.reviewer!==record.content.qaOwner||record.designReview?.decision!=='approved'))throw new Error('Preparation receipt lacks exact independent design provenance');
      if(record.sliceReceipt?.firstSlice&&record.sliceReceipt.firstSlice.recordSha256!==record.sha256)throw new Error('First-slice receipt refers to a different record');
      if(record.sliceReceipt && record.designReview?.decision !== 'approved') throw new Error('Slice receipt lacks independent design approval');
      for(const rows of [record.taskReviews??[],record.taskAcceptances??[]])if(new Set(rows.map(r=>r.issue)).size!==rows.length)throw new Error('Duplicate task evidence identities');
      for(const row of [...record.taskReviews??[],...record.taskAcceptances??[]])if(row.taskHash!==taskScopeHash(record,row.issue)||row.reviewer!==record.content.qaOwner)throw new Error('Task evidence has a stale scope or invalid reviewer');
      for(const review of record.taskReviews??[]){const source=state.records.find(r=>r.id===review.designRecord.id&&r.revision===review.designRecord.revision&&r.sha256===review.designRecord.sha256);if(!source||source.repoId!==record.repoId||source.revision>record.revision||source.designReview?.decision!=='approved'||source.designReview.artifactSha256!==review.artifactSha256||taskScopeHash(source,review.issue)!==review.taskHash)throw new Error('Task review lacks its independently approved design provenance');if(review.sliceReceipt&&JSON.stringify(review.sliceReceipt)!==JSON.stringify(source.sliceReceipt))throw new Error('Task review has invalid slice provenance');}
      for(const receipt of record.taskAcceptances??[]){if(record.taskReviews?.find(r=>r.issue===receipt.issue)?.decision!=='approved')throw new Error('Task acceptance lacks current independent task review');for(const dep of taskScope(record.content,receipt.issue)?.tasks.filter(t=>t.issue!==receipt.issue)??[])if(!record.taskAcceptances?.some(a=>a.issue===dep.issue))throw new Error('Task acceptance lacks accepted prerequisites');
        if(receipt.reconciliation){const r=receipt.reconciliation,source=state.records.find(s=>s.id===r.sourceRecord.id&&s.revision===r.sourceRecord.revision&&s.sha256===r.sourceRecord.sha256);if(!source)throw new Error('Reconciliation source record missing');assertEvidenceOnlyRevision(source,record,receipt.issue,Date.parse(receipt.acceptedAt));const original=source.taskAcceptances?.find(a=>a.issue===receipt.issue);if(!original||original.taskHash!==r.sourceTaskHash||r.reviewer!==record.content.qaOwner||r.reviewedAt!==receipt.acceptedAt||['prNumber','headSha','mergeCommitSha','evidenceHash','reviewer'].some(k=>original[k as keyof typeof original]!==receipt[k as keyof typeof receipt]))throw new Error('Reconciled acceptance differs from its immutable original');assertOriginalTaskQa(source,original,receipt.issue,r.originalQa);}
      }
    }
    this.records = state.records; this.ready = true;
  }
  private assertOpen() {if(!this.ready || this.closed) throw new HttpError(503,'Delivery records unavailable; inspect storage/recovery before proceeding');}
  view(repoId: string) {this.assertOpen(); return structuredClone(this.records.filter(row => row.repoId === repoId).sort((a,b)=>b.revision-a.revision));}
  current(repoId: string) {
    this.assertOpen();
    let latest: DeliveryRecord | undefined;
    for (const row of this.records) if (row.repoId === repoId && (!latest || row.revision > latest.revision)) latest = row;
    return latest ? structuredClone(latest) : null;
  }
  private match(repoId:string, ref:RecordReference) {
    const record = this.current(repoId);
    if(!record || record.id!==ref.id || record.revision!==ref.revision || record.sha256!==ref.sha256) throw new HttpError(409,'Delivery record changed; reload and review the current revision');
    return record;
  }
  assertContext(record:Pick<DeliveryRecord,'content'>, context:RecordContext) {
    if(record.content.findings.some(f=>f.executionEvidence)&&context.executionEvidenceVersion!==1)throw new HttpError(409,'Phase execution admission is not configured; approval and execution remain blocked');
    if(!recordScopeMatches(record,context)) throw new HttpError(409,'Brief or target changed; update discovery and obtain a fresh design review');
    if(record.content.governanceProfile&&record.content.governanceProfile.tenantId.toLowerCase()!==context.tenantId?.toLowerCase())throw new HttpError(409,'Governance entitlement profile does not match the approved tenant');
  }
  private async publish(next: DeliveryRecord[], guard:()=>void) {
    this.assertOpen(); guard();
    const checked = stateSchema.parse({schemaVersion:1, records:next});
    try {await this.storage.save(checked.records,()=>{this.assertOpen();guard();});}
    catch(error) {if(!(error instanceof HttpError))this.ready = false;throw error;}
    this.records = checked.records;
  }
  save(repoId:string, expectedRevision:number, content:unknown, actor:string, guard:()=>void = ()=>{}) {
    return this.writer.write(async()=>{
      this.assertOpen(); guard();const old=this.current(repoId);
      if((old?.revision ?? 0)!==expectedRevision) throw new HttpError(409,'Delivery record changed; reload before saving');
      const parsed=deliveryRecordContentSchema.parse(content);
      if(old?.content.applicationSpec&&!parsed.applicationSpec)throw new HttpError(409,'Application specification cannot be silently removed; revise its assumptions, decisions and links instead');
      if(old?.content.taskPlan&&!parsed.taskPlan)throw new HttpError(409,'Task contracts cannot be silently removed');
      const record = {schemaVersion:1 as const,id:old?.id??crypto.randomUUID(),repoId,revision:expectedRevision+1,previousSha256:old?.sha256??null,content:parsed,updatedAt:new Date().toISOString(),updatedBy:actor};
      const next=deliveryRecordSchema.parse({...record,sha256:digest(record),...(parsed.taskPlan?{
        taskReviews:old?.taskReviews?.filter(r=>r.taskHash===taskScopeHash({content:parsed},r.issue))??[],
        taskAcceptances:old?.taskAcceptances?.filter(r=>r.taskHash===taskScopeHash({content:parsed},r.issue))??[],
      }: {})});
      const planning=taskPlanningBlockers(next);if(planning.length)throw new HttpError(409,planning.join('; '));
      await this.publish([...this.records,next],guard);return structuredClone(next);
    });
  }
  assertDiscovery(repoId:string,context:RecordContext) {
    const record=this.current(repoId);if(!record)throw new HttpError(409,'Create the shared delivery record and complete evidence-backed discovery first');
    this.assertContext(record,context);const blockers=[...discoveryBlockers(record),...taskPlanningBlockers(record)];
    if(blockers.length)throw new HttpError(409,blockers.join('; '));return record;
  }
  reconcileTask(repoId:string,ref:RecordReference,issue:number,sourceRef:RecordReference,notes:string,reviewer:string,context:RecordContext,verify:(source:DeliveryRecord,receipt:NonNullable<DeliveryRecord['taskAcceptances']>[number])=>Promise<OriginalTaskQa>,guard:()=>void=()=>{}) {
    return this.writer.write(async()=>{
      const current=this.match(repoId,ref);this.assertContext(current,context);
      if(reviewer!==current.content.qaOwner||reviewer===current.content.owner)throw new HttpError(403,'Only assigned independent QA may reconcile accepted work');
      this.assertWork(repoId,issue,context);
      const source=this.records.find(r=>r.repoId===repoId&&r.id===sourceRef.id&&r.revision===sourceRef.revision&&r.sha256===sourceRef.sha256);
      if(!source)throw new HttpError(409,'Original accepted record is unavailable');
      assertEvidenceOnlyRevision(source,current,issue);
      const original=source.taskAcceptances?.find(r=>r.issue===issue);
      if(!original||source.designReview?.decision!=='approved'||source.taskReviews?.find(r=>r.issue===issue)?.decision!=='approved'||original.reviewer!==reviewer)throw new HttpError(409,'Original independent acceptance is unavailable');
      guard();const originalQa=await verify(structuredClone(source),structuredClone(original));guard();this.match(repoId,ref);this.assertWork(repoId,issue,context);
      assertEvidenceOnlyRevision(source,current,issue);assertOriginalTaskQa(source,original,issue,originalQa);
      const stamp=new Date().toISOString();
      const receipt=taskAcceptanceSchema.parse({...original,taskHash:taskScopeHash(current,issue),acceptedAt:stamp,reconciliation:{sourceRecord:sourceRef,sourceTaskHash:original.taskHash,originalQa,reviewer,reviewedAt:stamp,notes}});
      const existing=current.taskAcceptances?.find(r=>r.issue===issue);
      if(existing){if(existing.reconciliation?.sourceRecord.sha256===sourceRef.sha256&&existing.evidenceHash===receipt.evidenceHash)return structuredClone(current);throw new HttpError(409,'Current task already has a different acceptance');}
      const next={...current,taskAcceptances:[...current.taskAcceptances??[],receipt]};
      await this.publish(this.records.map(r=>r.repoId===repoId&&r.revision===current.revision?next:r),()=>{guard();this.match(repoId,ref);this.assertWork(repoId,issue,context);assertEvidenceOnlyRevision(source,current,issue);});return structuredClone(next);
    });
  }
  review(repoId:string,ref:RecordReference,input:unknown,reviewer:string,context:RecordContext,guard:()=>void=()=>{}) {
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertContext(record,context);
      if(reviewer!==record.content.qaOwner||reviewer===record.content.owner)throw new HttpError(403,'Only the assigned independent QA session may review this design');
      if(record.sliceReceipt||record.preparationReceipt)throw new HttpError(409,'Accepted execution review is immutable; save a new record revision');
      const review=recordReviewSchema.parse({...recordReviewSchema.omit({reviewer:true,reviewedAt:true}).parse(input),reviewer,reviewedAt:new Date().toISOString()});
      if(review.decision==='approved')this.assertDiscovery(repoId,context);
      const {inputReview:_inputReview,...reviewable}=record;
      const next={...reviewable,designReview:review,...(review.decision==='rejected'?{taskReviews:[],taskAcceptances:[]}: {})};
      await this.publish(this.records.map(row=>row.repoId===repoId&&row.revision===record.revision?next:row),guard);return structuredClone(next);
    });
  }
  rejectInputs(repoId:string,ref:RecordReference,input:unknown,reviewer:string,context:RecordContext,guard:()=>void=()=>{}){
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertContext(record,context);
      if(reviewer!==record.content.qaOwner||reviewer===record.content.owner)throw new HttpError(403,'Only assigned independent QA may reject missing planning inputs');
      if(record.sliceReceipt||record.preparationReceipt)throw new HttpError(409,'Accepted execution review is immutable; save a new record revision');
      const review=inputReviewSchema.parse({...inputReviewSchema.omit({reviewer:true,reviewedAt:true}).parse(input),reviewer,reviewedAt:new Date().toISOString()});
      if(review.missingInputs.includes('task-contracts')&&(!record.content.applicationSpec||record.content.taskPlan))throw new HttpError(409,'Task contracts are not missing from this application record');
      const {designReview:_design,...rejected}=record;
      const next={...rejected,inputReview:review,taskReviews:[],taskAcceptances:[]};
      await this.publish(this.records.map(row=>row.repoId===repoId&&row.revision===record.revision?next:row),guard);return structuredClone(next);
    });
  }
  assertWork(repoId:string,issue:number,context:RecordContext) {
    const record=this.current(repoId);if(!record)throw new HttpError(409,'Create a shared delivery record before assigning implementation');
    this.assertContext(record,context);
    const task=record.content.tasks.find(task=>task.issue===issue);
    if(!task)throw new HttpError(409,issue?`Link issue #${issue} to requirements and a stage in the delivery record`:'Link this repair to an issue and its requirements/stage in the delivery record');
    // Draft design is read-only and may describe unresolved discovery. Approval
    // and every authoring path still require the complete evidence/contracts.
    if(task.stage==='discovery'||task.stage==='design')return;
    if(record.content.applicationSpec&&!record.content.taskPlan)throw new HttpError(409,'Application delivery requires task contracts before authoring');
    if(record.content.taskPlan){
      if(record.content.taskPlan.schemaVersion!==2)throw new HttpError(409,'Migrate legacy task contracts to version 2 with independent integration QA before authoring');
      const scoped=taskScope(record.content,issue);if(!scoped)throw new HttpError(409,'Task execution contract is missing');
      const planning=taskPlanningBlockers(record);if(planning.length)throw new HttpError(409,planning.join('; '));
      if(Buffer.byteLength(taskInputPrompt(record,issue))>TASK_CONTEXT_BYTES)throw new HttpError(409,'Task context exceeds 24 KiB; split the task or reduce its scope before authoring');
      const blockers=discoveryBlockers({...record,content:{...record.content,applicationSpec:record.content.applicationSpec?{...record.content.applicationSpec,decisions:scoped.decisions,assumptions:scoped.assumptions}:undefined}});
      if(blockers.length)throw new HttpError(409,blockers.join('; '));
      const review=record.taskReviews?.find(r=>r.issue===issue);
      if(review?.decision!=='approved'||review.taskHash!==taskScopeHash(record,issue))throw new HttpError(409,'Independent approval of the exact task scope is required');
      for(const dep of scoped.tasks.filter(t=>t.issue!==issue))if(!record.taskAcceptances?.some(a=>a.issue===dep.issue&&a.taskHash===taskScopeHash(record,dep.issue)))throw new HttpError(409,`Task #${issue} waits for independently accepted dependency #${dep.issue}`);
      if(task.stage==='slice'&&task.requirementIds.some(id=>!record.content.slice.requirementIds.includes(id)))throw new HttpError(409,'Slice task exceeds the declared first journey');
      if(task.stage==='implementation'&&(!record.sliceReceipt&&!review.sliceReceipt||record.content.applicationSpec&&(!(record.sliceReceipt??review.sliceReceipt)?.firstSlice||!(record.sliceReceipt??review.sliceReceipt)?.qualityAcceptance)))throw new HttpError(409,'Independently accepted first slice is required');
      return;
    }
    this.assertDiscovery(repoId,context);
    if(record.designReview?.decision!=='approved')throw new HttpError(409,'Independent design review is required before implementation');
    if(task.stage==='slice' && task.requirementIds.some(id=>!record.content.slice.requirementIds.includes(id)))throw new HttpError(409,'Slice task exceeds the declared first journey');
    if(task.stage==='implementation'&&(!record.sliceReceipt||record.content.applicationSpec&&(!record.sliceReceipt.firstSlice||!record.sliceReceipt.qualityAcceptance)))throw new HttpError(409,'Deploy and independently accept the first vertical slice before wider implementation');
  }
  assertRelease(repoId:string,plan:DeliveryRelease['plan'],context:RecordContext) {
    if(!plan.deliveryRecord)throw new HttpError(409,'Pin the shared delivery record and release purpose');
    const record=this.match(repoId,plan.deliveryRecord);this.assertDiscovery(repoId,context);
    if(record.content.findings.some(f=>f.executionEvidence)&&!plan.verification.headlessFlow)throw new HttpError(409,'Phase evidence currently requires the guarded headless verification adapter');
    if(record.content.owner!==plan.owner||record.content.qaOwner!==plan.qaOwner)throw new HttpError(409,'Release ownership differs from the shared record');
    if(record.designReview?.decision!=='approved'||record.designReview.artifactSha256!==plan.architecture?.sha256||record.designReview.docId!==plan.architecture.docId)throw new HttpError(409,'Release must use the independently reviewed design');
    if(plan.deliveryRecord.purpose==='expansion'&&(!record.sliceReceipt||record.content.applicationSpec&&(!record.sliceReceipt.firstSlice||!record.sliceReceipt.qualityAcceptance)))throw new HttpError(409,'First deployed slice acceptance is required before an expansion release');
    const preparation=plan.deliveryRecord.purpose==='preparation';
    const preparationRequirements=record.content.taskPlan?.integrationQa?.find(q=>q.purpose==='preparation')?.requirementIds??[];
    if(preparation&&(!preparationRequirements.length||plan.verification.headlessFlow?.dataMode!=='synthetic'||plan.verification.headlessFlow.operationScope!=='standard-mail-v1'||plan.verification.headlessFlow.allowDispatch||plan.firstSlice))throw new HttpError(409,'Explicit independently reviewed synthetic preparation contract is required');
    const headless=plan.verification?.headlessFlow;
    if(headless?.operationScope==='standard-mail-v1'&&headless.dataMode==='mailbox'&&(!record.preparationReceipt||record.preparationReceipt.recordSha256!==record.sha256||record.preparationReceipt.definitionSha256!==headless.definitionSha256||record.preparationReceipt.flowId.toLowerCase()!==headless.flowId.toLowerCase()))throw new HttpError(409,'Exact independently accepted synthetic preparation is required before private execution');
    const expected=preparation?record.content.requirements.filter(r=>preparationRequirements.includes(r.id)).map(r=>r.acceptance):plan.deliveryRecord.purpose==='slice'?record.content.slice.acceptanceCriteria:record.content.requirements.map(r=>r.acceptance);
    if(expected.some(text=>!plan.acceptanceCriteria.includes(text)))throw new HttpError(409,'Release omits declared acceptance criteria');
    for(const issue of plan.requiredIssues){const task=record.content.tasks.find(task=>task.issue===issue);if(!task||!['slice','implementation'].includes(task.stage)||plan.deliveryRecord.purpose!=='expansion'&&task.stage!=='slice')throw new HttpError(409,'Release issues must belong to the declared delivery stage');}
    const requirementIds=preparation?preparationRequirements:plan.deliveryRecord.purpose==='slice'?record.content.slice.requirementIds:record.content.requirements.map(r=>r.id);
    if(requirementIds.some(id=>!record.content.tasks.some(task=>plan.requiredIssues.includes(task.issue)&&task.requirementIds.includes(id))))throw new HttpError(409,'Release issues do not cover every required journey requirement');
    assertFirstSlicePlan(record.content,plan);
    if(record.content.taskPlan)for(const issue of plan.requiredIssues)if(!record.taskAcceptances?.some(a=>a.issue===issue&&a.taskHash===taskScopeHash(record,issue)))throw new HttpError(409,`Release issue #${issue} requires independently accepted merged task evidence`);
    assertQualityPlan(record.content,plan);
    return record;
  }
  reviewTask(repoId:string,ref:RecordReference,issue:number,input:{taskHash:string;decision:'approved'|'rejected';notes:string},reviewer:string,context:RecordContext,guard:()=>void=()=>{}){
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertContext(record,context);
      if(reviewer!==record.content.qaOwner||reviewer===record.content.owner)throw new HttpError(403,'Only assigned independent QA may review task contracts');
      const scope=taskScope(record.content,issue);if(!scope||input.taskHash!==taskScopeHash(record,issue))throw new HttpError(409,'Task scope changed; inspect the current contract');
      const design=record.designReview;
      if(design?.decision!=='approved')throw new HttpError(409,'An independently approved current design is required before task review');
      const review=taskReviewSchema.parse({...input,issue,reviewer,reviewedAt:new Date().toISOString(),designRecord:recordReference(record),artifactSha256:design.artifactSha256,...(record.sliceReceipt?{sliceReceipt:record.sliceReceipt}:{})});
      const next={...record,taskReviews:[...record.taskReviews?.filter(r=>r.issue!==issue)??[],review],taskAcceptances:record.taskAcceptances?.filter(a=>!taskScope(record.content,a.issue)?.tasks.some(t=>t.issue===issue))??[]};
      await this.publish(this.records.map(r=>r.repoId===repoId&&r.revision===record.revision?next:r),guard);return structuredClone(next);
    });
  }
  acceptTask(repoId:string,ref:RecordReference,issue:number,evidence:{prNumber:number;headSha:string;mergeCommitSha:string;evidenceHash:string},reviewer:string,context:RecordContext,guard:()=>void=()=>{}){
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);if(reviewer!==record.content.qaOwner||reviewer===record.content.owner)throw new HttpError(403,'Only assigned independent QA may accept task evidence');
      this.assertWork(repoId,issue,context);
      const taskHash=taskScopeHash(record,issue);if(!taskHash)throw new HttpError(409,'Task contract is missing');
      const acceptance=taskAcceptanceSchema.parse({...evidence,issue,taskHash,reviewer,acceptedAt:new Date().toISOString()});
      const old=record.taskAcceptances?.find(a=>a.issue===issue);
      if(old&&old.taskHash===taskHash&&old.prNumber===evidence.prNumber&&old.headSha===evidence.headSha&&old.mergeCommitSha===evidence.mergeCommitSha&&old.evidenceHash===evidence.evidenceHash)return structuredClone(record);
      const next={...record,taskAcceptances:[...record.taskAcceptances?.filter(a=>a.issue!==issue)??[],acceptance]};
      await this.publish(this.records.map(r=>r.repoId===repoId&&r.revision===record.revision?next:r),guard);return structuredClone(next);
    });
  }
  acceptSlice(repoId:string,ref:RecordReference,release:DeliveryRelease,run:DeliveryRun,context:RecordContext,guard:()=>void=()=>{}) {
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertRelease(repoId,release.plan,context);
      if(release.repoId!==repoId||release.environmentUrl!==record.content.environmentUrl||release.plan.deliveryRecord?.purpose!=='slice'||run.repoId!==repoId||run.releaseId!==release.id||run.phase!=='complete'||!run.evidenceHash||run.visualReview?.reviewer!==record.content.qaOwner||run.visualReview.evidenceHash!==run.evidenceHash||run.head!==release.head||run.environmentUrl!==record.content.environmentUrl)throw new HttpError(409,'A completed, independently accepted slice deployment on this target is required');
      if(record.content.applicationSpec&&(!run.firstSlice||run.firstSlice.contractHash!==firstSliceContractHash(release.plan)||!run.evidence.includes(run.firstSlice.evidenceFile)))throw new HttpError(409,'Runner-owned first-slice execution evidence is required');
      if(record.content.applicationSpec&&(!run.qualityEvidence||!run.qualityReview||run.qualityReview.reviewer!==record.content.qaOwner||run.qualityReview.evidenceHash!==run.evidenceHash))throw new HttpError(409,'Independent QA and documentation evidence is required before slice acceptance');
      const receipt=sliceReceiptSchema.parse({...(run.qualityEvidence&&run.qualityReview?{qualityAcceptance:{reviewer:run.qualityReview.reviewer,evidenceHash:run.evidenceHash,contractHash:run.qualityEvidence.contractHash,artifactSha256:run.qualityEvidence.artifactSha256}}:{}),...(run.firstSlice?{firstSlice:{...run.firstSlice,planHash:release.planHash,recordSha256:record.sha256}}:{}),releaseId:release.id,runId:run.id,evidenceHash:run.evidenceHash,head:run.head,acceptedAt:new Date().toISOString()});
      const next={...record,sliceReceipt:receipt};await this.publish(this.records.map(row=>row.repoId===repoId&&row.revision===record.revision?next:row),guard);return structuredClone(next);
    });
  }
  acceptPreparation(repoId:string,ref:RecordReference,release:DeliveryRelease,run:DeliveryRun,context:RecordContext,guard:()=>void=()=>{}){
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertRelease(repoId,release.plan,context);
      const flow=release.plan.verification.headlessFlow;
      if(release.plan.deliveryRecord?.purpose!=='preparation'||flow?.dataMode!=='synthetic'||flow.operationScope!=='standard-mail-v1'||flow.allowDispatch||flow.privateReport||release.repoId!==repoId||release.environmentUrl!==record.content.environmentUrl||run.repoId!==repoId||run.releaseId!==release.id||run.phase!=='complete'||!run.evidenceHash||run.head!==release.head||run.environmentUrl!==record.content.environmentUrl||run.visualReview?.reviewer!==record.content.qaOwner||run.visualReview.evidenceHash!==run.evidenceHash||!run.recovery||!run.qualityEvidence||run.qualityReview?.reviewer!==record.content.qaOwner||run.qualityReview.evidenceHash!==run.evidenceHash)throw new HttpError(409,'Completed independently accepted synthetic preparation evidence is required');
      const receipt=preparationReceiptSchema.parse({recordSha256:record.sha256,releaseId:release.id,runId:run.id,evidenceHash:run.evidenceHash,planHash:release.planHash,head:run.head,packageSha256:run.recovery.packageSha256,definitionSha256:flow.definitionSha256,flowId:flow.flowId,reviewer:record.content.qaOwner,acceptedAt:new Date().toISOString()});
      if(record.preparationReceipt){if(JSON.stringify({...record.preparationReceipt,acceptedAt:receipt.acceptedAt})!==JSON.stringify(receipt))throw new HttpError(409,'Accepted preparation is immutable; save and independently review a new revision');return structuredClone(record);}
      const next={...record,preparationReceipt:receipt};await this.publish(this.records.map(row=>row.repoId===repoId&&row.revision===record.revision?next:row),guard);return structuredClone(next);
    });
  }
  async close(){this.closed=true;await this.writer.drain().catch(()=>undefined);}
}
