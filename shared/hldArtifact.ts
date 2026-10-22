import {z} from 'zod';
import {recordReferenceSchema} from './deliveryRecord.ts';
const text=z.string().trim().min(1).max(8000);
export const hldInputSchema=z.strictObject({solutionName:text,problemContext:text,tenantName:text.optional(),components:z.array(z.strictObject({role:text,title:text,badge:text,details:text,deliverables:z.array(z.string().trim().min(1).max(500)).max(100)})).max(100)});
const content=z.string().min(1).max(1024*1024);
export const hldResultSchema=z.strictObject({docId:z.string().regex(/^HLD-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),generatedAt:z.number().int().nonnegative(),solutionName:text,status:z.literal('draft'),deliveryRecord:recordReferenceSchema.optional(),generationMethod:z.enum(['requirements-template','model-synthesis']),synthesis:z.strictObject({runtime:z.enum(['codex-cli','claude-sdk']),jobId:z.uuid(),startedAt:z.number().int().nonnegative(),elapsedMs:z.number().int().nonnegative(),deadlineMs:z.literal(300000)}).optional(),missingEvidence:z.array(text).max(100),implementationPlan:z.array(z.strictObject({id:text,title:text,deliverables:z.array(text).max(100),acceptance:z.array(text).max(100)})).max(104),markdownContent:content,mermaidDiagrams:z.strictObject({topology:content,erd:content,sequence:content})});
export const hldArtifactSchema=z.strictObject({schemaVersion:z.literal(1),repoId:text.nullable(),input:hldInputSchema,result:hldResultSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)});
export type HldArtifact=z.infer<typeof hldArtifactSchema>;
