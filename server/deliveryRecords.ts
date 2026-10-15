import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {SerialWriter, atomicWrite} from './atomicFile.ts';
import {readBoundedJson} from './boundedJson.ts';
import {HttpError} from './httpError.ts';
import {deliveryRecordSchema, deliveryRecordContentSchema, discoveryBlockers, recordReviewSchema, sliceReceiptSchema, type DeliveryRecord, type RecordReference} from '../shared/deliveryRecord.ts';
import type {DeliveryRelease, DeliveryRun} from '../shared/delivery.ts';

const MAX_BYTES = 4 * 1024 * 1024;
const stateSchema = z.strictObject({schemaVersion:z.literal(1), records:z.array(deliveryRecordSchema).max(1000)});
export interface RecordContext {brief:string; environmentUrl?:string;tenantId?:string}
const digest = (record: Pick<DeliveryRecord,'id'|'repoId'|'revision'|'previousSha256'|'content'>) => crypto.createHash('sha256').update(JSON.stringify({id:record.id,repoId:record.repoId,revision:record.revision,previousSha256:record.previousSha256,content:record.content})).digest('hex');
export class DeliveryRecords {
  private records: DeliveryRecord[] = [];
  private writer = new SerialWriter();
  private ready = false;
  private closed = false;
  constructor(private home: string) {}
  async init() {
    this.ready=false;
    const value = await readBoundedJson(path.join(this.home,'delivery-records.json'), MAX_BYTES);
    const state = value === undefined ? {records:[]} : stateSchema.parse(value);
    const identities = new Set<string>();
    for (const record of state.records) {
      const key = `${record.repoId}:${record.revision}`;
      if (identities.has(key) || digest(record) !== record.sha256) throw new Error('Delivery record history is inconsistent; preserve it before repair');
      identities.add(key);
      const previous = state.records.find(row => row.repoId === record.repoId && row.revision === record.revision - 1);
      if (record.revision === 1 ? record.previousSha256 !== null : !previous || previous.id !== record.id || previous.sha256 !== record.previousSha256) throw new Error('Delivery record history has a missing or changed revision');
      if(record.designReview && record.designReview.reviewer !== record.content.qaOwner) throw new Error('Delivery record reviewer differs from its assigned QA owner');
      if(record.sliceReceipt && record.designReview?.decision !== 'approved') throw new Error('Slice receipt lacks independent design approval');
    }
    this.records = state.records; this.ready = true;
  }
  private assertOpen() {if(!this.ready || this.closed) throw new HttpError(503,'Delivery records unavailable; inspect storage/recovery before proceeding');}
  view(repoId: string) {this.assertOpen(); return structuredClone(this.records.filter(row => row.repoId === repoId).sort((a,b)=>b.revision-a.revision));}
  current(repoId: string) {return this.view(repoId)[0] ?? null;}
  private match(repoId:string, ref:RecordReference) {
    const record = this.current(repoId);
    if(!record || record.id!==ref.id || record.revision!==ref.revision || record.sha256!==ref.sha256) throw new HttpError(409,'Delivery record changed; reload and review the current revision');
    return record;
  }
  assertContext(record:Pick<DeliveryRecord,'content'>, context:RecordContext) {
    if(record.content.brief !== context.brief || record.content.environmentUrl?.replace(/\/$/,'').toLowerCase() !== context.environmentUrl?.replace(/\/$/,'').toLowerCase()) throw new HttpError(409,'Brief or target changed; update discovery and obtain a fresh design review');
    if(record.content.governanceProfile&&record.content.governanceProfile.tenantId.toLowerCase()!==context.tenantId?.toLowerCase())throw new HttpError(409,'Governance entitlement profile does not match the approved tenant');
  }
  private async publish(next: DeliveryRecord[], guard:()=>void) {
    this.assertOpen(); guard();
    const checked = stateSchema.parse({schemaVersion:1, records:next});
    const bytes = JSON.stringify(checked);
    if(Buffer.byteLength(bytes) > MAX_BYTES) throw new HttpError(413,'Delivery record retention is full; preserve/export history before continuing');
    try {await atomicWrite(path.join(this.home,'delivery-records.json'),bytes,()=>{this.assertOpen();guard();return true;});}
    catch(error) {if(!(error instanceof HttpError))this.ready = false;throw error;}
    this.records = checked.records;
  }
  save(repoId:string, expectedRevision:number, content:unknown, actor:string, guard:()=>void = ()=>{}) {
    return this.writer.write(async()=>{
      this.assertOpen(); guard();const old=this.current(repoId);
      if((old?.revision ?? 0)!==expectedRevision) throw new HttpError(409,'Delivery record changed; reload before saving');
      const parsed=deliveryRecordContentSchema.parse(content);
      const record = {schemaVersion:1 as const,id:old?.id??crypto.randomUUID(),repoId,revision:expectedRevision+1,previousSha256:old?.sha256??null,content:parsed,updatedAt:new Date().toISOString(),updatedBy:actor};
      const next=deliveryRecordSchema.parse({...record,sha256:digest(record)});
      await this.publish([...this.records,next],guard);return structuredClone(next);
    });
  }
  assertDiscovery(repoId:string,context:RecordContext) {
    const record=this.current(repoId);if(!record)throw new HttpError(409,'Create the shared delivery record and complete evidence-backed discovery first');
    this.assertContext(record,context);const blockers=discoveryBlockers(record);
    if(blockers.length)throw new HttpError(409,blockers.join('; '));return record;
  }
  review(repoId:string,ref:RecordReference,input:unknown,reviewer:string,context:RecordContext,guard:()=>void=()=>{}) {
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertContext(record,context);
      if(reviewer!==record.content.qaOwner||reviewer===record.content.owner)throw new HttpError(403,'Only the assigned independent QA session may review this design');
      if(record.sliceReceipt)throw new HttpError(409,'Accepted slice review is immutable; save a new record revision');
      const review=recordReviewSchema.parse({...recordReviewSchema.omit({reviewer:true,reviewedAt:true}).parse(input),reviewer,reviewedAt:new Date().toISOString()});
      if(review.decision==='approved')this.assertDiscovery(repoId,context);
      const next={...record,designReview:review};
      await this.publish(this.records.map(row=>row.repoId===repoId&&row.revision===record.revision?next:row),guard);return structuredClone(next);
    });
  }
  assertWork(repoId:string,issue:number,context:RecordContext) {
    const record=this.current(repoId);if(!record)throw new HttpError(409,'Create a shared delivery record before assigning implementation');
    this.assertContext(record,context);
    const task=record.content.tasks.find(task=>task.issue===issue);
    if(!task)throw new HttpError(409,issue?`Link issue #${issue} to requirements and a stage in the delivery record`:'Link this repair to an issue and its requirements/stage in the delivery record');
    if(task.stage==='discovery')return;
    this.assertDiscovery(repoId,context);
    if(task.stage==='design')return;
    if(record.designReview?.decision!=='approved')throw new HttpError(409,'Independent design review is required before implementation');
    if(task.stage==='slice' && task.requirementIds.some(id=>!record.content.slice.requirementIds.includes(id)))throw new HttpError(409,'Slice task exceeds the declared first journey');
    if(task.stage==='implementation'&&!record.sliceReceipt)throw new HttpError(409,'Deploy and independently accept the first vertical slice before wider implementation');
  }
  assertRelease(repoId:string,plan:DeliveryRelease['plan'],context:RecordContext) {
    if(!plan.deliveryRecord)throw new HttpError(409,'Pin the shared delivery record and release purpose');
    const record=this.match(repoId,plan.deliveryRecord);this.assertDiscovery(repoId,context);
    if(record.content.owner!==plan.owner||record.content.qaOwner!==plan.qaOwner)throw new HttpError(409,'Release ownership differs from the shared record');
    if(record.designReview?.decision!=='approved'||record.designReview.artifactSha256!==plan.architecture?.sha256||record.designReview.docId!==plan.architecture.docId)throw new HttpError(409,'Release must use the independently reviewed design');
    if(plan.deliveryRecord.purpose==='expansion'&&!record.sliceReceipt)throw new HttpError(409,'First deployed slice acceptance is required before an expansion release');
    const expected=plan.deliveryRecord.purpose==='slice'?record.content.slice.acceptanceCriteria:record.content.requirements.map(r=>r.acceptance);
    if(expected.some(text=>!plan.acceptanceCriteria.includes(text)))throw new HttpError(409,'Release omits declared acceptance criteria');
    for(const issue of plan.requiredIssues){const task=record.content.tasks.find(task=>task.issue===issue);if(!task||!['slice','implementation'].includes(task.stage)||plan.deliveryRecord.purpose==='slice'&&task.stage!=='slice')throw new HttpError(409,'Release issues must belong to the declared delivery stage');}
    const requirementIds=plan.deliveryRecord.purpose==='slice'?record.content.slice.requirementIds:record.content.requirements.map(r=>r.id);
    if(requirementIds.some(id=>!record.content.tasks.some(task=>plan.requiredIssues.includes(task.issue)&&task.requirementIds.includes(id))))throw new HttpError(409,'Release issues do not cover every required journey requirement');
    return record;
  }
  acceptSlice(repoId:string,ref:RecordReference,release:DeliveryRelease,run:DeliveryRun,context:RecordContext,guard:()=>void=()=>{}) {
    return this.writer.write(async()=>{
      const record=this.match(repoId,ref);this.assertRelease(repoId,release.plan,context);
      if(release.repoId!==repoId||release.environmentUrl!==record.content.environmentUrl||release.plan.deliveryRecord?.purpose!=='slice'||run.repoId!==repoId||run.releaseId!==release.id||run.phase!=='complete'||!run.evidenceHash||run.visualReview?.reviewer!==record.content.qaOwner||run.visualReview.evidenceHash!==run.evidenceHash||run.head!==release.head||run.environmentUrl!==record.content.environmentUrl)throw new HttpError(409,'A completed, independently accepted slice deployment on this target is required');
      const receipt=sliceReceiptSchema.parse({releaseId:release.id,runId:run.id,evidenceHash:run.evidenceHash,head:run.head,acceptedAt:new Date().toISOString()});
      const next={...record,sliceReceipt:receipt};await this.publish(this.records.map(row=>row.repoId===repoId&&row.revision===record.revision?next:row),guard);return structuredClone(next);
    });
  }
  async close(){this.closed=true;await this.writer.drain().catch(()=>undefined);}
}
