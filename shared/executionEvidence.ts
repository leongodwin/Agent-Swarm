import {z} from 'zod';

export const executionPhases=['authoring','deployment','private-data','verification','dispatch'] as const;
export type ExecutionPhase=typeof executionPhases[number];
/** Fixed metadata probes only. These never establish effective DLP, inference,
 * service-history privacy, report quality or successful delivery. */
export const executionProbes=['project-readiness','headless-authoring-rights','private-report-acl'] as const;
export const executionEvidenceContractSchema=z.strictObject({
 schemaVersion:z.literal(1),probe:z.enum(executionProbes),
 configurationSha256:z.string().regex(/^[a-f0-9]{64}$/),
 maxAgeMs:z.literal(60000),
 designRationale:z.string().trim().min(80).max(2000),
});
export type ExecutionEvidenceContract=z.infer<typeof executionEvidenceContractSchema>;
export const isExecutionEvidence=(value:unknown)=>executionEvidenceContractSchema.safeParse(value).success;
