import {z} from 'zod';
import {hldResultSchema} from './hldArtifact.ts';
const detail=z.string().trim().min(20).max(8000),label=z.string().trim().min(1).max(500);
export const synthesisOutputSchema=z.strictObject({
  summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,
  decisions:z.array(z.strictObject({decision:detail,rationale:detail,alternatives:detail})).min(1).max(30),
  risks:z.array(z.strictObject({risk:detail,mitigation:detail})).min(1).max(30),
  requirements:z.array(z.strictObject({requirementId:label,sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),planStepIds:z.array(label).min(1).max(104),requirement:z.string().min(1).max(128*1024),design:detail,acceptance:detail})).min(1).max(1000),
  missingEvidence:z.array(label).min(1).max(100),
  skillBindings:z.array(z.strictObject({skillId:label,sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),planStepIds:z.array(label).min(1).max(104),rationale:detail,toolStatus:z.literal('unverified')})).max(100),
  implementationPlan:hldResultSchema.shape.implementationPlan.min(3),mermaidDiagrams:hldResultSchema.shape.mermaidDiagrams,
});
export const synthesisJobSchema=z.strictObject({id:z.uuid(),repoId:z.string().min(1).max(8000),status:z.enum(['queued','checking','running','saving','completed','blocked','failed','cancelled']),
  runtimeCleanup:z.enum(['awaiting-completion','released']).optional(),
  monotonicElapsedMs:z.number().int().nonnegative().optional(),
  runtime:z.enum(['codex-cli','claude-sdk']),startedAt:z.number().int().nonnegative(),endedAt:z.number().int().nonnegative().optional(),elapsedMs:z.number().int().nonnegative().optional(),deadlineMs:z.literal(300000),
  events:z.array(z.strictObject({at:z.number().int().nonnegative(),kind:z.enum(['progress','error']),text:z.string().max(1000)})).max(100),
  error:z.string().max(4000).optional(),costUsd:z.number().finite().nonnegative(),turns:z.number().int().nonnegative(),
  result:z.strictObject({docId:hldResultSchema.shape.docId,artifactSha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
}).superRefine((job,ctx)=>{if(job.status==='completed'&&(!job.result||job.endedAt===undefined||job.elapsedMs===undefined||job.elapsedMs>=job.deadlineMs||job.monotonicElapsedMs!==undefined&&job.monotonicElapsedMs>=job.deadlineMs||job.endedAt<job.startedAt||job.elapsedMs!==job.endedAt-job.startedAt))ctx.addIssue({code:'custom',message:'Completed synthesis requires an intact result and consistent duration within its deadline'});});
export type SynthesisJob=z.infer<typeof synthesisJobSchema>;
export interface SynthesisSummary {
  scope:'retained-codex-synthesis-jobs';observedAt:number;window:{from:number;to:number};coverageStartedAt:number;completeWindow:boolean;
  recorded:{completed:number;failed:number;blocked:number;cancelled:number;active:number;awaitingCleanup:number;legacyProviderJobs:number};
  successfulDurationMs:{count:number;median:number|null;p95:number|null};
  durationCoverage?:{monotonic:number;wallClockOnly:number};
  recordedCompletionPercent:number|null;completeWindowCompletionPercent:number|null;reason:string;
}
