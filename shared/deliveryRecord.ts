import {z} from 'zod';
import {governanceProfileSchema,governanceProfileBlockers} from './governanceProfile.ts';

const text = z.string().trim().min(1).max(4000);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const discoveryAreas = ['repository', 'user-journey', 'data', 'security', 'integrations', 'authoring', 'deployment', 'verification'] as const;
export const findingSchema = z.strictObject({
  id, area: z.enum(discoveryAreas), statement: text,
  status: z.enum(['observed', 'assumed', 'unresolved']), critical: z.boolean(),
  conclusion: z.enum(['ready','blocked','unknown','not-applicable']).optional(),
  owner: id, remedy: text,
  evidence: z.array(z.strictObject({reference: text, sha256, observedAt: z.iso.datetime(), expiresAt: z.iso.datetime()})).max(20),
});
export const deliveryRecordContentSchema = z.strictObject({
  brief: text, outcome: text, successMeasure: text, users: z.array(text).min(1).max(30),
  scope: z.array(text).min(1).max(50), exclusions: z.array(text).max(50),
  owner: id, qaOwner: id,
  governanceProfile:governanceProfileSchema.optional(),
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
  if(value.governanceProfile&&value.governanceProfile.environmentUrl.replace(/\/$/,'').toLowerCase()!==value.environmentUrl?.replace(/\/$/,'').toLowerCase())fail('Governance profile must match the delivery target');
  for (const key of ['requirements', 'findings', 'contracts'] as const) if (new Set(value[key].map(item => item.id)).size !== value[key].length) fail(`Duplicate ${key} IDs`);
  if (new Set(value.tasks.map(task => task.issue)).size !== value.tasks.length) fail('Duplicate task issues');
  const known = new Set(value.requirements.map(item => item.id));
  for (const linked of [...value.contracts, ...value.tasks, value.slice]) if (linked.requirementIds.some(ref => !known.has(ref)) || new Set(linked.requirementIds).size !== linked.requirementIds.length) fail('Requirement links must be unique and refer to declared requirements');
  for (const finding of value.findings) {
    if (finding.status === 'observed' && !finding.evidence.length) fail('Observed findings need evidence');
    for (const evidence of finding.evidence) if (Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt)) fail('Evidence expiry must follow observation');
  }
});
export type DeliveryRecordContent = z.infer<typeof deliveryRecordContentSchema>;
export const recordReferenceSchema = z.strictObject({id: z.uuid(), revision: z.number().int().positive(), sha256});
export const recordReviewSchema = z.strictObject({artifactSha256: sha256, docId: z.string().regex(/^HLD-[a-f0-9-]{36}$/i), reviewer: id, decision: z.enum(['approved','rejected']), notes: z.string().trim().min(80).max(8000), reviewedAt: z.iso.datetime()});
export const sliceReceiptSchema = z.strictObject({releaseId: z.uuid(), runId: z.uuid(), evidenceHash: sha256, head: z.string().regex(/^[a-f0-9]{40,64}$/), acceptedAt: z.iso.datetime()});
export const deliveryRecordSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.uuid(), repoId: text, revision: z.number().int().positive(), sha256,
  updatedAt: z.iso.datetime(), updatedBy: id, previousSha256: sha256.nullable(), content: deliveryRecordContentSchema,
  designReview: recordReviewSchema.optional(), sliceReceipt: sliceReceiptSchema.optional(),
});
export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;
export type RecordReference = z.infer<typeof recordReferenceSchema>;

/** Coverage is structural. Evidence and conclusions still need independent review. */
export function discoveryBlockers(record: DeliveryRecord, now = Date.now()): string[] {
  const findings = record.content.findings;
  const blockers = discoveryAreas.filter(area => !findings.some(f => f.area === area && f.status === 'observed')).map(area => `Inspect ${area} and record evidence`);
  if(!record.content.sourceCommit)blockers.push('Inspect and pin the discovery source commit');
  if(!record.content.environmentUrl)blockers.push('Discover and approve the deployment target');
  if(record.content.governanceProfile)blockers.push(...governanceProfileBlockers(record.content.governanceProfile,now));
  for (const finding of findings) {
    if (finding.critical && finding.status !== 'observed') blockers.push(`${finding.id}: ${finding.remedy} (owner: ${finding.owner})`);
    if (finding.critical && finding.status === 'observed' && !['ready','not-applicable'].includes(finding.conclusion??'unknown')) blockers.push(`${finding.id}: ${finding.remedy} (owner: ${finding.owner}; observed ${finding.conclusion??'unknown'})`);
    if (finding.critical && finding.status === 'observed' && finding.evidence.some(e => Date.parse(e.observedAt) > now + 60_000 || Date.parse(e.expiresAt) <= now)) blockers.push(`${finding.id}: refresh stale or future-dated evidence (owner: ${finding.owner})`);
  }
  return blockers;
}
export function recordReference(record: DeliveryRecord): RecordReference {return {id:record.id, revision:record.revision, sha256:record.sha256};}
export function recordPhase(record: DeliveryRecord): string {
  if (discoveryBlockers(record).length) return 'discovery';
  if (record.designReview?.decision !== 'approved') return 'design';
  return record.sliceReceipt ? 'implementation' : 'slice';
}
