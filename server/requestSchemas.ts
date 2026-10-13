import { z } from 'zod';
import { HttpError } from './httpError.ts';
import {proposalInputSchema} from '../shared/proposals.ts';
import {hldInputSchema} from '../shared/hldArtifact.ts';
const text = z.string().trim().min(1).max(8000);
export const proposalSchema = proposalInputSchema;
export const hldSchema = hldInputSchema.extend({repoId:text.optional()}).strict();
export const loginSchema = z.object({ name: z.string().trim().min(1).max(30).optional(),
  environmentUrl: z.url().refine((url) => new URL(url).protocol === 'https:', 'Environment must use HTTPS').optional(),
  tenantId: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/).optional(),
  applicationId: z.uuid().optional(), clientSecret: z.string().min(1).max(4000).optional(), interactive: z.boolean().default(true), authMethod: z.enum(['interactive', 'device-code']).optional() }).strict()
  .refine((input) => input.interactive ? !input.applicationId && !input.clientSecret : !!input.tenantId && !!input.applicationId && !!input.clientSecret && !input.authMethod,
    'Service principal login requires tenant, application ID and secret; interactive login must omit credentials');
export const selectSchema = z.object({ index: z.number().int().positive() }).strict();
export const notifySchema = z.object({ title: text, subtitle: text.default('Office activity'), summary: text.default('Office notification'),
  facts: z.array(z.object({ title: z.string().max(200), value: z.string().max(1000) }).strict()).max(30).default([]) }).strict();
export const approveSchema = z.object({ approver: z.string().trim().min(1).max(100).optional() }).strict();
export function parseBody<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  return parsed.data;
}
