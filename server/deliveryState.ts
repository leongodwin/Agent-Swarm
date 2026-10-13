import crypto from 'node:crypto';
import { z } from 'zod';
import { releasePlanSchema } from './releasePlan.ts';
import type { DeliveryPolicy, DeliveryRun, DeliveryRelease, DeliveryBlocker } from '../shared/delivery.ts';

export interface DeliveryStoredState { schemaVersion: 1; policy: DeliveryPolicy | null; runs: DeliveryRun[]; releases: DeliveryRelease[]; blockers: DeliveryBlocker[]; revision: number }
const text = z.string().min(1).max(4000);
const identity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/).refine(value => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value));
const repo = z.string().min(1).max(240).refine(value => !/[\x00-\x1f]/.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const https = z.url().max(4096).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; });
const relative = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f:]/.test(value) && value.replaceAll('\\','/').split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe evidence path');
const when = z.iso.datetime();
const operation = z.object({ id:text,kind:z.enum(['import','post-deploy']),status:z.enum(['intent','reported-success','verified','unknown']),commandSha256:hash,startedAt:when,endedAt:when.optional(),platformJobId:z.string().max(200).optional() }).strict();
const release = z.object({id:identity,repoId:repo,head:commit,environmentUrl:https,plan:releasePlanSchema,planHash:hash,createdAt:when,approvedAt:when.optional(),approvedBy:text.optional(),
  skillLock:z.array(z.object({id:text,sha256:hash,version:z.string().max(200).optional(),file:z.string().min(1).max(4096)}).strict()).max(1000).optional(),
}).strict();
const run = z.object({id:identity,repoId:repo,head:z.string().min(1).max(128),environmentUrl:https,phase:z.enum(['disabled','waiting','building','testing','deploying','verifying','reviewing','complete','blocked']),
  startedAt:when,endedAt:when.optional(),error:z.string().max(4000).optional(),solution:z.string().max(200).optional(),version:z.string().max(200).optional(),
  appUrls:z.array(https).max(100),evidence:z.array(relative).max(10000),log:z.array(z.string().max(8000)).max(10000),
  releaseId:identity.optional(),previousRunId:identity.optional(),checkpoint:z.enum(['prepared','import-started','imported','post-started','deployed']).optional(),recoveryRequired:z.boolean().optional(),evidenceHash:hash.optional(),
  operations:z.array(operation).max(1000).optional(),
  acceptance:z.object({profile:z.enum(['production','functional-development']),limitations:z.array(z.string().max(4000)).max(100)}).strict().optional(),
  visualReview:z.object({reviewer:text,reviewedAt:when,scores:z.array(z.number().int().min(4).max(5)).max(5),notes:z.string().min(40).max(4000),evidenceHash:hash}).strict().optional(),
  recovery:z.object({inventoryFile:relative,runbook:relative,drillReport:relative,packageSha256:hash}).strict().optional(),
  health:z.object({status:z.enum(['pending','healthy','degraded']),checkedAt:when.optional(),nextCheckAt:when,error:z.string().max(4000).optional(),capabilityHash:z.string().min(1).max(256).optional(),governanceEvidence:relative.optional()}).strict().optional(),
}).strict();
const schema = z.object({schemaVersion:z.literal(1).optional(),policy:z.object({enabled:z.boolean(),environmentUrl:https,approvedAt:when,copilotPaused:z.boolean().optional()}).strict().nullable(),
  runs:z.array(run).max(10000),releases:z.array(release).max(10000).optional(),blockers:z.array(z.object({repoId:repo,releaseId:identity.optional(),owner:text,error:z.string().max(4000),recovery:text,at:when}).strict()).max(10000).optional(),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

/** Validate raw objects without normalizing approved plans or reordering their
 * keys: historical hashes bind the exact serialized plan, target and skill lock. */
export function validateDeliveryState(input: unknown): DeliveryStoredState {
  schema.parse(input);
  const state = structuredClone(input) as DeliveryStoredState;
  state.schemaVersion = 1; state.releases ??= []; state.blockers ??= []; state.revision ??= 0;
  for (const entries of [state.runs,state.releases]) if (new Set(entries.map(entry=>entry.id)).size !== entries.length) throw new Error('Duplicate delivery identities');
  if (new Set(state.blockers.map(entry=>entry.repoId)).size !== state.blockers.length) throw new Error('Duplicate delivery blockers');
  for (const item of state.releases) {
    const digest=crypto.createHash('sha256').update(JSON.stringify({plan:item.plan,head:item.head,environmentUrl:item.environmentUrl,skillLock:item.skillLock})).digest('hex');
    if (digest !== item.planHash) throw new Error('Release hash differs from its saved contract');
    if (!!item.approvedAt !== !!item.approvedBy || item.approvedBy && item.approvedBy !== item.plan.qaOwner) throw new Error('Release approval is not bound to its independent reviewer');
    if (item.skillLock && new Set(item.skillLock.map(skill=>skill.id)).size !== item.skillLock.length) throw new Error('Duplicate release skill identities');
  }
  for (const item of state.runs) {
    if (item.operations && new Set(item.operations.map(operation=>operation.id)).size !== item.operations.length) throw new Error('Duplicate operation history');
    if (new Set(item.evidence).size !== item.evidence.length) throw new Error('Duplicate delivery evidence');
    const contract=state.releases.find(release=>release.id===item.releaseId);
    if (item.releaseId && (!contract || contract.repoId!==item.repoId || contract.head!==item.head || contract.environmentUrl!==item.environmentUrl)) throw new Error('Run differs from its pinned release');
    if (item.previousRunId) {
      const prior=state.runs.find(run=>run.id===item.previousRunId);
      if (!prior || prior===item || prior.repoId!==item.repoId || prior.environmentUrl!==item.environmentUrl) throw new Error('Previous run is missing or outside this target');
    }
    if (item.visualReview && (!contract || !contract.approvedAt || item.visualReview.reviewer!==contract.plan.qaOwner || item.visualReview.evidenceHash!==item.evidenceHash || item.visualReview.scores.length!==(contract.plan.verification.api?0:5))) throw new Error('Evidence review differs from its release');
    if (contract && item.phase==='complete' && !item.visualReview) throw new Error('Completed scoped delivery lacks independent evidence review');
  }
  for (const item of state.blockers) if (item.releaseId && !state.releases.some(release=>release.id===item.releaseId && release.repoId===item.repoId)) throw new Error('Blocker refers to a different or missing release');
  return state;
}
