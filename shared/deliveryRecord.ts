import {qualityAcceptanceSchema} from './qualityEvidence.ts';
import {firstSliceResultSchema} from './firstSlice.ts';
import {z} from 'zod';
import {governanceProfileSchema,governanceProfileBlockers} from './governanceProfile.ts';
import {applicationSpecSchema,applicationSpecLinkErrors,applicationSpecBlockers} from './applicationSpec.ts';
import {taskPlanSchema,taskPlanErrors} from './taskPlan.ts';
import {executionEvidenceContractSchema} from './executionEvidence.ts';

const text = z.string().trim().min(1).max(4000);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const discoveryAreas = ['repository', 'user-journey', 'data', 'security', 'integrations', 'authoring', 'deployment', 'verification'] as const;
export const canvasOwnershipRecoveryScopeSchema=z.strictObject({
  kind:z.literal('canvas-ownership-recovery'),taskIssue:z.number().int().positive(),
  environmentUrl:z.url(),appId:z.uuid(),leaseOwner:id,
  method:z.literal('original-token-release'),remoteStudioUnlock:z.literal(false),
  releasedAt:z.iso.datetime(),releaseEvidenceSha256:sha256,
});
/** Proposed recovery metadata, not proof of a provider operation or a new lease.
 * Independent review must inspect the hash-matching release receipt. */
export function ownershipRecoveryScopeMatches(environmentUrl:string|null|undefined,task:{owner:string;resources:string[]},scope:z.infer<typeof canvasOwnershipRecoveryScopeSchema>,evidence:{sha256:string;observedAt:string;expiresAt:string}[],at?:number){
  try{
    const target=new URL(scope.environmentUrl),expected=new URL(environmentUrl??'');
    if(scope.kind!=='canvas-ownership-recovery'||scope.method!=='original-token-release'||scope.remoteStudioUnlock!==false||target.protocol!=='https:'||target.origin!==expected.origin||target.username||target.password||target.pathname!=='/'||target.search||target.hash||scope.leaseOwner!==task.owner||!task.resources.some(r=>r.toLowerCase()===`canvas_${scope.appId.toLowerCase()}`))return false;
    const proofs=evidence.filter(e=>e.sha256===scope.releaseEvidenceSha256);if(proofs.length!==1)return false;
    const proof=proofs[0],released=Date.parse(scope.releasedAt),observed=Date.parse(proof.observedAt),expires=Date.parse(proof.expiresAt);
    return Number.isFinite(released)&&released<=observed&&observed<expires&&(at===undefined||Number.isFinite(at)&&observed<=at&&at<expires);
  }catch{return false;}
}
export const findingSchema = z.strictObject({
  id, area: z.enum(discoveryAreas), statement: text,
  status: z.enum(['observed', 'assumed', 'unresolved']), critical: z.boolean(),
  conclusion: z.enum(['ready','blocked','unknown','not-applicable']).optional(),
  executionEvidence:executionEvidenceContractSchema.optional(),
  scope:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('canvas-source-sync'),taskIssue:z.number().int().positive()}),canvasOwnershipRecoveryScopeSchema]).optional(),
  owner: id, remedy: text,
  evidence: z.array(z.strictObject({reference: text, sha256, observedAt: z.iso.datetime(), expiresAt: z.iso.datetime()})).max(20),
});
export const deliveryRecordContentSchema = z.strictObject({
  brief: text, outcome: text, successMeasure: text, users: z.array(text).min(1).max(30),
  scope: z.array(text).min(1).max(50), exclusions: z.array(text).max(50),
  owner: id, qaOwner: id,
  governanceProfile:governanceProfileSchema.optional(),
  applicationSpec:applicationSpecSchema.optional(),
  taskPlan:taskPlanSchema.optional(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/).nullable(),
  environmentUrl: z.url().refine(value => {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;}).nullable(),
  requirements: z.array(z.strictObject({id, description: text, acceptance: text})).min(1).max(100),
  findings: z.array(findingSchema).max(200),
  contracts: z.array(z.strictObject({id, owner: id, description: text, requirementIds: z.array(id).min(1).max(100)})).max(100),
  tasks: z.array(z.strictObject({issue: z.number().int().positive(), stage: z.enum(['discovery', 'design', 'slice', 'implementation']), requirementIds: z.array(id).min(1).max(100)})).max(200),
  slice: z.strictObject({description: text, requirementIds: z.array(id).min(1).max(100), acceptanceCriteria: z.array(text).min(1).max(30)}),
}).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({code:'custom', message});
  if (value.owner === value.qaOwner) fail('Delivery owner and independent QA owner must differ');
  if(value.applicationSpec)for(const error of applicationSpecLinkErrors(value.applicationSpec,value))fail(error);
  if(value.taskPlan)for(const error of taskPlanErrors(value))fail(error);
  if(value.governanceProfile&&value.governanceProfile.environmentUrl.replace(/\/$/,'').toLowerCase()!==value.environmentUrl?.replace(/\/$/,'').toLowerCase())fail('Governance profile must match the delivery target');
  for (const key of ['requirements', 'findings', 'contracts'] as const) if (new Set(value[key].map(item => item.id)).size !== value[key].length) fail(`Duplicate ${key} IDs`);
  if (new Set(value.tasks.map(task => task.issue)).size !== value.tasks.length) fail('Duplicate task issues');
  const known = new Set(value.requirements.map(item => item.id));
  for (const linked of [...value.contracts, ...value.tasks, value.slice]) if (linked.requirementIds.some(ref => !known.has(ref)) || new Set(linked.requirementIds).size !== linked.requirementIds.length) fail('Requirement links must be unique and refer to declared requirements');
  for (const finding of value.findings) {
    if(finding.executionEvidence){
      if(!finding.critical||finding.scope||!value.applicationSpec?.components.length||value.applicationSpec.components.some(c=>c.platform!=='flow')||value.taskPlan?.schemaVersion!==2)fail('Execution evidence requires an explicit critical headless-only version-2 task contract');
      const areas=finding.executionEvidence.probe==='private-report-acl'?['security','verification']:finding.executionEvidence.probe==='headless-authoring-rights'?['security','authoring']:['security','integrations','authoring'];
      if(!areas.includes(finding.area))fail('Execution evidence probe does not cover this finding area');
    }
    if(finding.scope){const task=value.taskPlan?.tasks.find(t=>t.issue===finding.scope!.taskIssue),components=task?.componentIds.map(id=>value.applicationSpec?.components.find(c=>c.id===id));if(finding.area!=='authoring'||!task||task.owner!==finding.owner||!components?.length||components.some(c=>!c||c.platform!=='canvas'||c.owner!==finding.owner))fail('Canvas prerequisite finding must belong to its Canvas-only author task');else if(finding.scope.kind==='canvas-ownership-recovery'&&!ownershipRecoveryScopeMatches(value.environmentUrl,task,finding.scope,finding.evidence))fail('Canvas ownership recovery must bind its task resource, owner, environment and exact release evidence');}
    if (finding.status === 'observed' && !finding.evidence.length) fail('Observed findings need evidence');
    for (const evidence of finding.evidence) if (Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt)) fail('Evidence expiry must follow observation');
  }
});
export type DeliveryRecordContent = z.infer<typeof deliveryRecordContentSchema>;
export const recordReferenceSchema = z.strictObject({id: z.uuid(), revision: z.number().int().positive(), sha256});
export const recordReviewSchema = z.strictObject({artifactSha256: sha256, docId: z.string().regex(/^HLD-[a-f0-9-]{36}$/i), reviewer: id, decision: z.enum(['approved','rejected']), notes: z.string().trim().min(80).max(8000), reviewedAt: z.iso.datetime()});
export const inputReviewSchema=z.strictObject({decision:z.literal('rejected'),reviewer:id,reviewedAt:z.iso.datetime(),notes:z.string().trim().min(80).max(8000),missingInputs:z.array(z.enum(['architecture','task-contracts'])).min(1).max(2).refine(v=>new Set(v).size===v.length,'Duplicate missing inputs')});
export const sliceReceiptSchema = z.strictObject({qualityAcceptance:qualityAcceptanceSchema.optional(),firstSlice:firstSliceResultSchema.extend({planHash:sha256,recordSha256:sha256}).optional(),releaseId: z.uuid(), runId: z.uuid(), evidenceHash: sha256, head: z.string().regex(/^[a-f0-9]{40,64}$/), acceptedAt: z.iso.datetime()});
export const preparationReceiptSchema=z.strictObject({recordSha256:sha256,releaseId:z.uuid(),runId:z.uuid(),evidenceHash:sha256,planHash:sha256,head:z.string().regex(/^[a-f0-9]{40,64}$/),packageSha256:sha256,definitionSha256:sha256,flowId:z.uuid(),reviewer:id,acceptedAt:z.iso.datetime()});
export const taskReviewSchema=z.strictObject({issue:z.number().int().positive(),taskHash:sha256,reviewer:id,decision:z.enum(['approved','rejected']),notes:z.string().trim().min(80).max(8000),reviewedAt:z.iso.datetime(),designRecord:recordReferenceSchema,artifactSha256:sha256,sliceReceipt:sliceReceiptSchema.optional()});
export const originalTaskQaSchema=z.strictObject({prNumber:z.number().int().positive(),status:z.literal('passed'),issueNumber:z.number().int().positive(),passedSha:z.string().regex(/^[a-f0-9]{40,64}$/),qaAgentId:id,commentUrl:z.url(),summary:z.string().min(1).max(16000),checks:z.array(z.strictObject({name:z.string().min(1).max(16000),result:z.literal('pass'),details:z.string().min(1).max(16000)})).min(1).max(200),taskAuthorityHash:sha256});
export const taskAcceptanceSchema=z.strictObject({issue:z.number().int().positive(),taskHash:sha256,reviewer:id,prNumber:z.number().int().positive(),headSha:z.string().regex(/^[a-f0-9]{40,64}$/),mergeCommitSha:z.string().regex(/^[a-f0-9]{40,64}$/),evidenceHash:sha256,acceptedAt:z.iso.datetime(),
  reconciliation:z.strictObject({sourceRecord:recordReferenceSchema,sourceTaskHash:sha256,originalQa:originalTaskQaSchema,reviewer:id,reviewedAt:z.iso.datetime(),notes:z.string().trim().min(80).max(8000)}).optional(),
});
export const deliveryRecordSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.uuid(), repoId: text, revision: z.number().int().positive(), sha256,
  updatedAt: z.iso.datetime(), updatedBy: id, previousSha256: sha256.nullable(), content: deliveryRecordContentSchema,
  designReview: recordReviewSchema.optional(), inputReview:inputReviewSchema.optional(), sliceReceipt: sliceReceiptSchema.optional(), preparationReceipt:preparationReceiptSchema.optional(),
  taskReviews:z.array(taskReviewSchema).max(200).optional(),taskAcceptances:z.array(taskAcceptanceSchema).max(200).optional(),
});
export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;
export type RecordReference = z.infer<typeof recordReferenceSchema>;

/** Coverage is structural. Evidence and conclusions still need independent review. */
export function discoveryBlockers(record: DeliveryRecord, now = Date.now()): string[] {
  const findings = record.content.findings;
  const planningBlockers=record.content.applicationSpec&&!record.content.taskPlan?['Application delivery requires task contracts before design approval or authoring']:[];
  const blockers = discoveryAreas.filter(area => !findings.some(f => f.area === area && f.status === 'observed')).map(area => `Inspect ${area} and record evidence`);
  if(!deliveryRecordContentSchema.safeParse(record.content).success)blockers.push('Historical planning contract requires a current-schema revision and fresh independent approval before authoring or delivery');
  if(!record.content.sourceCommit)blockers.push('Inspect and pin the discovery source commit');
  if(!record.content.environmentUrl)blockers.push('Discover and approve the deployment target');
  if(record.content.applicationSpec)blockers.push(...applicationSpecBlockers(record.content.applicationSpec,findings,now));
  if(record.content.governanceProfile)blockers.push(...governanceProfileBlockers(record.content.governanceProfile,now));
  for (const finding of findings) {
    // Approval covers this explicit fixed probe contract, not continued validity
    // of historical observations. Actual operations require separate fresh,
    // server-owned admission receipts. Unclassified findings remain strict.
    if(finding.executionEvidence)continue;
    if (finding.critical && finding.status !== 'observed') blockers.push(`${finding.id}: ${finding.remedy} (owner: ${finding.owner})`);
    if (finding.critical && finding.status === 'observed' && !['ready','not-applicable'].includes(finding.conclusion??'unknown')) blockers.push(`${finding.id}: ${finding.remedy} (owner: ${finding.owner}; observed ${finding.conclusion??'unknown'})`);
    if (finding.critical && finding.status === 'observed' && finding.evidence.some(e => Date.parse(e.observedAt) > now + 60_000 || Date.parse(e.expiresAt) <= now)) blockers.push(`${finding.id}: refresh stale or future-dated evidence (owner: ${finding.owner})`);
  }
  return [...planningBlockers,...blockers];
}
export function recordReference(record: DeliveryRecord): RecordReference {return {id:record.id, revision:record.revision, sha256:record.sha256};}
export function recordPhase(record: DeliveryRecord): string {
  if (discoveryBlockers(record).length) return 'discovery';
  if (record.designReview?.decision !== 'approved') return 'design';
  return record.sliceReceipt ? 'implementation' : 'slice';
}
