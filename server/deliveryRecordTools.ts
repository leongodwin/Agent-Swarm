import {z} from 'zod';
import {DeliveryRecords, type RecordContext} from './deliveryRecords.ts';
import {deliveryRecordContentSchema, findingSchema, recordReferenceSchema, recordReference, recordPhase, discoveryBlockers} from '../shared/deliveryRecord.ts';
import {hldResultSchema} from '../shared/hldArtifact.ts';
import {loadHldVersion,loadLatestHld} from './hldArtifacts.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {HttpError} from './httpError.ts';
import {hldInputSchema} from '../shared/hldArtifact.ts';
import type {HldSynthesisService} from './hldSynthesis.ts';
import type {RecordToolHandler} from './ceo.ts';
import type {DeliveryView} from '../shared/delivery.ts';

export interface RecordToolContext {
  repo(repoId:string):RecordContext & {checkoutPath:string};
  agents():{id:string;repoId:string;role:string}[];
  delivery(repoId:string):DeliveryView;
  assertOpen():void;
  synthesis?:Pick<HldSynthesisService,'start'|'view'|'result'>;
  inspectRepository?(checkoutPath:string,guard:()=>void):Promise<{evidence:{reference:string;sha256:string;observedAt:string;expiresAt:string};observation:{sourceCommit:string}}>;
}
export function deliveryRecordHandler(records:DeliveryRecords,deps:RecordToolContext,actor:{id:string;role:'ceo'|'dev'|'qa'|'manager';repoId?:string;reviewOnly?:boolean}):RecordToolHandler {
  return async input => {
    deps.assertOpen();
    if(actor.reviewOnly&&!['read','review','accept_slice'].includes(input.action))throw new HttpError(403,'Independent review cannot change its discovery inputs; report findings in the review notes');
    if(actor.repoId&&actor.repoId!==input.repo_id)throw new HttpError(403,'Delivery record belongs to another project');
    const context=deps.repo(input.repo_id);
    const guard=()=>{deps.assertOpen();const current=deps.repo(input.repo_id);if(current.brief!==context.brief||current.environmentUrl!==context.environmentUrl||current.tenantId!==context.tenantId||current.checkoutPath!==context.checkoutPath)throw new HttpError(409,'Project scope changed during record update');};
    const current=records.current(input.repo_id);
    if(input.action==='read') {
      let architectureDraft:unknown=null;
      try{const artifact=await loadLatestHld(context.checkoutPath,guard,input.repo_id);if(artifact)architectureDraft={docId:artifact.result.docId,artifactSha256:artifact.sha256,deliveryRecord:artifact.result.deliveryRecord,method:artifact.result.generationMethod,result:artifact.result,jsonPath:`docs/architecture/drafts/${artifact.result.docId}.json`,markdownPath:`docs/architecture/drafts/${artifact.result.docId}.md`};}
      catch{architectureDraft={unavailable:'Saved architecture is unreadable; inspect its artifacts before review'};}
      guard();return JSON.stringify({record:current,architectureDraft,history:records.view(input.repo_id).map(({id,revision,sha256,updatedAt,updatedBy})=>({id,revision,sha256,updatedAt,updatedBy})),phase:current?recordPhase(current):'not-started',blockers:current?discoveryBlockers(current):['Create the shared delivery record'],contextMatches:current?current.content.brief===context.brief&&current.content.environmentUrl===context.environmentUrl:false});
    }
    const payload=parseUnambiguousJson(input.payload_json??'{}',{maxBytes:256*1024});
    if(input.expected_revision!==(current?.revision??0))throw new HttpError(409,'Delivery record changed; reload before updating');
    if(input.action==='save') {
      if(!['ceo','manager'].includes(actor.role))throw new HttpError(403,'Only the CEO or manager can change scope, contracts or task planning');
      const content=deliveryRecordContentSchema.parse(payload);records.assertContext({content},context);
      const agents=deps.agents();
      if(!agents.some(a=>a.repoId===input.repo_id&&a.id===content.owner&&a.role==='dev')||!agents.some(a=>a.repoId===input.repo_id&&a.id===content.qaOwner&&a.role==='qa'))throw new HttpError(400,'Assign a developer and a separate QA agent from this project');
      return JSON.stringify(await records.save(input.repo_id,input.expected_revision,content,actor.id,guard));
    }
    if(!current)throw new HttpError(409,'Create the shared delivery record first');
    if(input.action==='synthesize_design'||input.action==='design_result') {
      if(!['ceo','dev'].includes(actor.role)||!deps.synthesis)throw new HttpError(403,'Design synthesis requires a planning/engineering session and an available synthesis service');
      records.assertContext(current,context);
      if(input.action==='synthesize_design')return JSON.stringify(await deps.synthesis.start(input.repo_id,hldInputSchema.parse(payload)));
      const {jobId}=z.strictObject({jobId:z.uuid()}).parse(payload);
      const job=deps.synthesis.view(input.repo_id,jobId)[0];
      return JSON.stringify({job,...(job.status==='completed'?{artifact:await deps.synthesis.result(input.repo_id,jobId)}:{})});
    }
    if(input.action==='inspect_repository') {
      if(!['dev','qa'].includes(actor.role)||!deps.inspectRepository)throw new HttpError(403,'Repository observation requires a project worker and the read-only discovery adapter');
      const {evidence,observation}=await deps.inspectRepository(context.checkoutPath,guard);
      const finding={id:'repository-inventory',area:'repository' as const,status:'observed' as const,conclusion:'ready' as const,critical:true,owner:actor.id,statement:'Inspected the committed repository inventory. Source semantics and working changes still need review.',remedy:'Inspect relevant source and resolve any uncommitted changes before relying on the design.',evidence:[evidence]};
      return JSON.stringify(await records.save(input.repo_id,current.revision,{...current.content,sourceCommit:observation.sourceCommit,findings:[...current.content.findings.filter(f=>f.id!==finding.id),finding]},actor.id,guard));
    }
    if(input.action==='finding') {
      if(!['dev','qa'].includes(actor.role))throw new HttpError(403,'Discovery findings must come from an active project worker');
      const data=z.strictObject({finding:findingSchema,sourceCommit:z.string().regex(/^[a-f0-9]{40,64}$/).optional()}).parse(payload);
      const content={...current.content,sourceCommit:data.sourceCommit??current.content.sourceCommit,findings:[...current.content.findings.filter(f=>f.id!==data.finding.id),data.finding]};
      return JSON.stringify(await records.save(input.repo_id,current.revision,content,actor.id,guard));
    }
    if(input.action==='review') {
      if(actor.role!=='qa'||actor.id!==current.content.qaOwner)throw new HttpError(403,'Only the assigned independent QA session can review discovery and design');
      const data=z.strictObject({reference:recordReferenceSchema,docId:hldResultSchema.shape.docId,artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','rejected']),notes:z.string().trim().min(80).max(8000)}).parse(payload);
      const artifact=await loadHldVersion(context.checkoutPath,input.repo_id,data.docId,data.artifactSha256,guard);
      if(JSON.stringify(artifact.result.deliveryRecord)!==JSON.stringify(recordReference(current)))throw new HttpError(409,'Architecture must be generated from this exact discovery revision');
      return JSON.stringify(await records.review(input.repo_id,data.reference,{docId:data.docId,artifactSha256:data.artifactSha256,decision:data.decision,notes:data.notes},actor.id,context,guard));
    }
    if(actor.role!=='qa'||actor.id!==current.content.qaOwner)throw new HttpError(403,'Only the assigned QA session can record slice acceptance');
    const data=z.strictObject({reference:recordReferenceSchema,runId:z.uuid()}).parse(payload);
    const view=deps.delivery(input.repo_id),run=view.runs.find(r=>r.id===data.runId),release=view.releases.find(r=>r.id===run?.releaseId);
    if(!run||!release)throw new HttpError(404,'Slice release/run not found in this project');
    const acceptanceGuard=()=>{guard();const live=deps.delivery(input.repo_id);const fresh=live.runs.find(r=>r.id===run.id),pinned=live.releases.find(r=>r.id===release.id);if(fresh?.phase!=='complete'||fresh.evidenceHash!==run.evidenceHash||fresh.visualReview?.evidenceHash!==run.evidenceHash||pinned?.planHash!==release.planHash)throw new HttpError(409,'Deployment acceptance changed while recording the slice; refresh evidence');};
    return JSON.stringify(await records.acceptSlice(input.repo_id,data.reference,release,run,context,acceptanceGuard));
  };
}
