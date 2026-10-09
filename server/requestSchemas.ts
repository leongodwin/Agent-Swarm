import { z } from 'zod';
import { HttpError } from './httpError.ts';
const text = z.string().trim().min(1).max(8000);
const strings = z.array(z.string().trim().min(1).max(500)).max(100);
export const proposalSchema = z.object({ title: text, clientName: text, industry: text, problemStatement: text,
  userCount: z.number().int().positive().max(1_000_000), monthlyTransactions: z.number().int().positive().max(1_000_000_000),
  complianceTier: z.enum(['standard', 'hipaa', 'financial']), targetChannels: strings, integrationPoints: strings }).strict();
export const hldSchema = z.object({ solutionName: text, problemContext: text, tenantName: text.optional(),
  repoId: text.optional(), components: z.array(z.object({ role: text, title: text, badge: text, details: text, deliverables: strings }).strict()).max(100) }).strict();
export const loginSchema = z.object({ name: z.string().trim().min(1).max(30).optional(),
  environmentUrl: z.url().refine((url) => new URL(url).protocol === 'https:', 'Environment must use HTTPS').optional(),
  tenantId: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/).optional(),
  applicationId: z.uuid().optional(), clientSecret: z.string().min(1).max(4000).optional(), interactive: z.boolean().default(true) }).strict()
  .refine((input) => input.interactive ? !input.applicationId && !input.clientSecret : !!input.tenantId && !!input.applicationId && !!input.clientSecret,
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
