import {z} from 'zod';
import {DeliveryRecords,recordScopeMatches, type RecordContext} from './deliveryRecords.ts';
import {originalTaskQaSchema,deliveryRecordContentSchema, findingSchema,inputReviewSchema, recordReferenceSchema, recordReference, recordPhase, discoveryBlockers} from '../shared/deliveryRecord.ts';
import {hldResultSchema} from '../shared/hldArtifact.ts';
import {loadHldVersion,loadLatestHld,hldAbsenceGuard} from './hldArtifacts.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {HttpError} from './httpError.ts';
import {hldInputSchema} from '../shared/hldArtifact.ts';
import type {HldSynthesisService} from './hldSynthesis.ts';
import type {RecordToolHandler} from './ceo.ts';
import type {DeliveryView} from '../shared/delivery.ts';
import {taskScopeHash} from './taskScope.ts';
import {readTaskInput,taskPlanningBlockers} from './taskInputs.ts';

const planning=deliveryRecordContentSchema.shape;
const planningAmendment=z.strictObject({
 outcome:planning.outcome.optional(),successMeasure:planning.successMeasure.optional(),users:planning.users.optional(),
 scope:planning.scope.optional(),exclusions:planning.exclusions.optional(),requirements:planning.requirements.optional(),
 contracts:planning.contracts.optional(),tasks:planning.tasks.optional(),slice:planning.slice.optional(),
 applicationSpec:planning.applicationSpec.optional(),taskPlan:planning.taskPlan.optional(),
}).refine(value=>Object.keys(value).length>0,'Supply at least one changed planning section');

export interface RecordToolContext {
  acceptedReports?:(repoId:string,record:import('../shared/deliveryRecord.ts').DeliveryRecord,guard:()=>void)=>Promise<unknown>;
  browserHandoff?:(repoId:string,payload:unknown,actor:{id:string;role:string},guard:()=>void)=>Promise<unknown>;
  repo(repoId:string):RecordContext & {checkoutPath:string};
  agents():{id:string;repoId:string;role:string}[];
  delivery(repoId:string):DeliveryView;
  assertOpen():void;
  verifySliceAcceptance?(runId:string):Promise<void>;
  verifyAcceptedTask?(repoId:string,issue:number,source:import('../shared/deliveryRecord.ts').DeliveryRecord,receipt:NonNullable<import('../shared/deliveryRecord.ts').DeliveryRecord['taskAcceptances']>[number],originalQa?:import('./taskReconciliation.ts').OriginalTaskQa):Promise<import('./taskReconciliation.ts').OriginalTaskQa>;
  schemaBootstrap?(repoId:string,payload:unknown,actor:{id:string;role:string},guard:()=>void):Promise<unknown>;
  canvasPackaging?(repoId:string,payload:unknown,actor:{id:string;role:string},guard:()=>void):Promise<unknown>;
  synthesis?:Pick<HldSynthesisService,'start'|'view'|'result'>;
  inspectRepository?(checkoutPath:string,guard:()=>void):Promise<{evidence:{reference:string;sha256:string;observedAt:string;expiresAt:string};observation:{sourceCommit:string}}>;
}
export function deliveryRecordHandler(records:DeliveryRecords,deps:RecordToolContext,actor:{id:string;role:'ceo'|'dev'|'qa'|'manager';repoId?:string;reviewOnly?:boolean}):RecordToolHandler {
  return async input => {
    deps.assertOpen();
    if(actor.reviewOnly&&!['browser_handoff','read','evidence_index','accepted_reports','task_input','review','reject_inputs','review_task','reconcile_task','accept_slice','schema_bootstrap','canvas_packaging'].includes(input.action))throw new HttpError(403,'Independent review cannot change its discovery inputs; report findings in the review notes');
    if(actor.repoId&&actor.repoId!==input.repo_id)throw new HttpError(403,'Delivery record belongs to another project');
    const context=deps.repo(input.repo_id);
    const guard=()=>{deps.assertOpen();const current=deps.repo(input.repo_id);if(current.brief!==context.brief||current.environmentUrl!==context.environmentUrl||current.tenantId!==context.tenantId||current.checkoutPath!==context.checkoutPath)throw new HttpError(409,'Project scope changed during record update');};
    const current=records.current(input.repo_id);
    if(input.action==='read') {
      let architectureDraft:unknown=null;
      try{const artifact=await loadLatestHld(context.checkoutPath,guard,input.repo_id);if(artifact)architectureDraft={docId:artifact.result.docId,artifactSha256:artifact.sha256,deliveryRecord:artifact.result.deliveryRecord,method:artifact.result.generationMethod,result:artifact.result,jsonPath:`docs/architecture/drafts/${artifact.result.docId}.json`,markdownPath:`docs/architecture/drafts/${artifact.result.docId}.md`};}
      catch{architectureDraft={unavailable:'Saved architecture is unreadable; inspect its artifacts before review'};}
      guard();return JSON.stringify({record:current,architectureDraft,taskScopes:current?.content.taskPlan?.tasks.map(t=>({issue:t.issue,taskHash:taskScopeHash(current,t.issue)}))??[],history:records.view(input.repo_id).map(({id,revision,sha256,updatedAt,updatedBy})=>({id,revision,sha256,updatedAt,updatedBy})),phase:current?recordPhase(current):'not-started',blockers:current?[...discoveryBlockers(current),...taskPlanningBlockers(current)]:['Create the shared delivery record'],contextMatches:current?recordScopeMatches(current,context):false});
    }
    // Complete manager saves include retained findings and executable task contracts.
    // Match the authenticated browser JSON ceiling without enlarging worker actions.
    const payloadLimit=input.action==='save'&&['ceo','manager'].includes(actor.role)?1024*1024:256*1024;
    const payloadText=input.payload_json??'{}';
    if(Buffer.byteLength(payloadText,'utf8')>payloadLimit)throw new HttpError(413,'Delivery record payload exceeds the bounded action limit; retain history and reduce the proposed update');
    const payload=parseUnambiguousJson(payloadText,{maxBytes:payloadLimit});
    if(input.action==='browser_handoff'){
      if(!deps.browserHandoff)throw new HttpError(503,'Coordinator browser handoff unavailable');
      guard();return JSON.stringify(await deps.browserHandoff(input.repo_id,payload,actor,guard));
    }
    if(input.action==='canvas_packaging'){
      if(!current||!deps.canvasPackaging||actor.role!=='qa'||actor.id!==current.content.qaOwner)throw new HttpError(403,'Canvas packaging review belongs to assigned independent QA');
      records.assertContext(current,context);return JSON.stringify(await deps.canvasPackaging(input.repo_id,payload,actor,guard));
    }
    if(input.action==='schema_bootstrap'){
      if(!current||!deps.schemaBootstrap||actor.role!=='qa'||actor.id!==current.content.qaOwner)throw new HttpError(403,'Schema bootstrap belongs to assigned independent QA');
      records.assertContext(current,context);return JSON.stringify(await deps.schemaBootstrap(input.repo_id,payload,actor,guard));
    }
    if(input.action==='evidence_index'){
      if(!current)throw new HttpError(409,'Discovery record is missing');
      const data=z.strictObject({reference:recordReferenceSchema.optional(),findingId:findingSchema.shape.id.optional(),startIndex:z.number().int().nonnegative().default(0),maxEntries:z.number().int().min(1).max(20).default(20)}).parse(payload);
      if(input.expected_revision!==undefined&&input.expected_revision!==current.revision||data.reference&&JSON.stringify(data.reference)!==JSON.stringify(recordReference(current))||data.startIndex>0&&!data.reference)throw new HttpError(409,'Evidence index changed or an exact record reference is required for later pages');
      if(data.findingId&&!current.content.findings.some(f=>f.id===data.findingId))throw new HttpError(404,'Discovery finding is missing');
      const entries=current.content.findings.filter(f=>!data.findingId||f.id===data.findingId).flatMap(f=>f.evidence.map(e=>({findingId:f.id,sha256:e.sha256,observedAt:e.observedAt,expiresAt:e.expiresAt})));
      if(data.startIndex>0&&data.startIndex>=entries.length)throw new HttpError(400,'Evidence index page is outside the record');
      const endIndex=Math.min(entries.length,data.startIndex+data.maxEntries);guard();
      return JSON.stringify({scope:'discovery-evidence-index',repoId:input.repo_id,reference:recordReference(current),entries:entries.slice(data.startIndex,endIndex),totalEntries:entries.length,nextIndex:endIndex<entries.length?endIndex:null,limits:['Metadata only; retrieve exact receipt bytes with read_delivery_source kind discovery-evidence','Expired evidence is historical; no inspection or approval is implied']});
    }
    if(input.action==='accepted_reports'){
      if(!current?.sliceReceipt||!deps.acceptedReports)throw new HttpError(409,'An independently accepted slice and report metadata reader are required');
      const data=z.strictObject({reference:recordReferenceSchema}).parse(payload),before=JSON.stringify(current.sliceReceipt);
      const owned=()=>{guard();const latest=records.current(input.repo_id);if(!latest||JSON.stringify(recordReference(latest))!==JSON.stringify(data.reference)||JSON.stringify(latest.sliceReceipt)!==before)throw new HttpError(409,'Accepted slice reference changed');};
      records.assertContext(current,context);owned();const result=await deps.acceptedReports(input.repo_id,current,owned);owned();return JSON.stringify(result);
    }
    if(input.action==='task_input'){
      if(!current)throw new HttpError(409,'Task record is missing');
      const data=z.strictObject({reference:recordReferenceSchema,issue:z.number().int().positive(),taskHash:z.string().regex(/^[a-f0-9]{64}$/),section:z.enum(['global','task','requirement','contract','finding','component','journey','decision','assumption','security','check','slice','integration']),id:z.string().min(1).max(100)}).parse(payload);
      if(input.expected_revision!==undefined&&input.expected_revision!==current.revision||JSON.stringify(data.reference)!==JSON.stringify(recordReference(current))||data.taskHash!==taskScopeHash(current,data.issue))throw new HttpError(409,'Task input record or scope changed; reload its manifest');
      const task=current.content.taskPlan?.tasks.find(t=>t.issue===data.issue);
      if(!task||!(actor.role==='ceo'||actor.role==='qa'&&actor.id===current.content.qaOwner||actor.role==='dev'&&actor.id===task.owner))throw new HttpError(403,'Only the task owner, assigned independent QA or coordinator may read task inputs');
      guard();return JSON.stringify(readTaskInput(current,data.issue,data.section,data.id));
    }
    if(input.expected_revision!==(current?.revision??0))throw new HttpError(409,'Delivery record changed; reload before updating');
    if(input.action==='save'||input.action==='amend_plan') {
      if(!['ceo','manager'].includes(actor.role))throw new HttpError(403,'Only the CEO or manager can change scope, contracts or task planning');
      if(input.action==='amend_plan'&&!current)throw new HttpError(409,'Create the shared delivery record before amending its plan');
      const content=deliveryRecordContentSchema.parse(input.action==='amend_plan'?{...current!.content,...planningAmendment.parse(payload)}:payload);records.assertContext({content},context);
      const agents=deps.agents();
      if(!agents.some(a=>a.repoId===input.repo_id&&a.id===content.owner&&a.role==='dev')||!agents.some(a=>a.repoId===input.repo_id&&a.id===content.qaOwner&&a.role==='qa'))throw new HttpError(400,'Assign a developer and a separate QA agent from this project');
      if(content.taskPlan?.tasks.some(t=>!agents.some(a=>a.repoId===input.repo_id&&a.id===t.owner&&a.role==='dev')))throw new HttpError(400,'Each task owner must be a developer on this project');
      return JSON.stringify(await records.save(input.repo_id,input.expected_revision,content,actor.id,guard));
    }
    if(!current)throw new HttpError(409,'Create the shared delivery record first');
    if(input.action==='reconcile_task'){
      if(actor.role!=='qa'||!deps.verifyAcceptedTask)throw new HttpError(403,'Independent QA and merged-source verification are required for reconciliation');
      const data=z.strictObject({reference:recordReferenceSchema,sourceRecord:recordReferenceSchema,originalQa:originalTaskQaSchema.optional(),issue:z.number().int().positive(),notes:z.string().trim().min(80).max(8000)}).parse(payload);
      return JSON.stringify(await records.reconcileTask(input.repo_id,data.reference,data.issue,data.sourceRecord,data.notes,actor.id,context,(source,receipt)=>deps.verifyAcceptedTask!(input.repo_id,data.issue,source,receipt,data.originalQa),guard));
    }
    if(input.action==='review_task'){
      if(actor.role!=='qa')throw new HttpError(403,'Only assigned independent QA may review task contracts');
      const data=z.strictObject({reference:recordReferenceSchema,issue:z.number().int().positive(),taskHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','rejected']),notes:z.string().min(80).max(8000)}).parse(payload);
      return JSON.stringify(await records.reviewTask(input.repo_id,data.reference,data.issue,{taskHash:data.taskHash,decision:data.decision,notes:data.notes},actor.id,context,guard));
    }
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
    if(input.action==='reject_inputs'){
      if(actor.role!=='qa'||actor.id!==current.content.qaOwner)throw new HttpError(403,'Only the assigned independent QA session may reject missing planning inputs');
      const data=z.strictObject({reference:recordReferenceSchema,...inputReviewSchema.omit({reviewer:true,reviewedAt:true,decision:true}).shape}).parse(payload);
      if(data.missingInputs.includes('architecture')&&await loadLatestHld(context.checkoutPath,guard,input.repo_id))throw new HttpError(409,'Architecture exists; review its exact version rather than claiming it is missing');
      const publishGuard=data.missingInputs.includes('architecture')?hldAbsenceGuard(context.checkoutPath,guard):guard;
      publishGuard();return JSON.stringify(await records.rejectInputs(input.repo_id,data.reference,{decision:'rejected',notes:data.notes,missingInputs:data.missingInputs},actor.id,context,publishGuard));
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
    if(current.content.applicationSpec){if(!deps.verifySliceAcceptance)throw new HttpError(409,'Trusted first-slice evidence verification is unavailable');await deps.verifySliceAcceptance(run.id);guard();}
    const acceptanceGuard=()=>{guard();const live=deps.delivery(input.repo_id);const fresh=live.runs.find(r=>r.id===run.id),pinned=live.releases.find(r=>r.id===release.id);if(fresh?.phase!=='complete'||fresh.evidenceHash!==run.evidenceHash||fresh.visualReview?.evidenceHash!==run.evidenceHash||pinned?.planHash!==release.planHash)throw new HttpError(409,'Deployment acceptance changed while recording the slice; refresh evidence');};
    return JSON.stringify(await records.acceptSlice(input.repo_id,data.reference,release,run,context,acceptanceGuard));
  };
}
