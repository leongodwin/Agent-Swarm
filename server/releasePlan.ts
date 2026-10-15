import { z } from 'zod';
import { cloudFlowCheckSchema } from './flowAdapter.ts';
import { apiVerificationSchema } from './apiVerification.ts';
import {hldResultSchema} from '../shared/hldArtifact.ts';
import {recordReferenceSchema} from '../shared/deliveryRecord.ts';
const text = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const step = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), path: z.string().startsWith('/').max(1000) }).strict(),
  z.object({ action: z.literal('click'), selector: text }).strict(),
  z.object({ action: z.literal('fill'), selector: text, value: z.string().max(1000) }).strict(),
  z.object({ action: z.literal('text'), selector: text, contains: text }).strict(),
  z.object({ action: z.literal('reload') }).strict(),
  z.object({ action: z.literal('press'), selector: text, key: z.enum(['Tab', 'Enter', 'Space', 'Escape', 'ArrowDown', 'ArrowUp']) }).strict(),
  z.object({ action: z.literal('upload'), selector: text, fixture: z.string().regex(/^[a-zA-Z0-9_-]+\.(pdf|png|jpg|jpeg|txt)$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export const releasePlanSchema = z.object({
  // Absent means the original strict contract; do not alter legacy plan hashes.
  acceptanceProfile: z.enum(['production', 'functional-development']).optional(),
  // Optional only for loading historical state. New release creation requires it.
  architecture: z.strictObject({docId:hldResultSchema.shape.docId,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
  deliveryRecord: recordReferenceSchema.extend({purpose:z.enum(['slice','expansion'])}).optional(),
  name: text, owner: id, qaOwner: id, requiredIssues: z.array(z.number().int().positive()).min(1).max(100),
  components: z.array(text).min(1).max(100), acceptanceCriteria: z.array(text).min(1).max(100),
  quality: z.object({ maxTaskDurationMs: z.number().int().min(1000).max(120000), maxSeriousAccessibilityIssues: z.literal(0) }).strict(),
  monitoring: z.object({ intervalMinutes: z.number().int().min(5).max(1440), criticalProbeIds: z.array(text).min(1).max(20) }).strict(),
  verification: z.object({
    api: apiVerificationSchema.optional(),
    cloudFlowChecks: z.array(cloudFlowCheckSchema).min(1).max(20).optional(),
    copilotChecks: z.array(z.object({ component: id, channelUrl: z.url(), cases: z.array(z.object({ kind: z.enum(['grounding', 'fallback', 'tool-action', 'authorization', 'safety', 'multi-turn']), scenario: text }).strict()).min(6).max(30) }).strict()).min(1).max(10).optional(),
    frame: z.object({ selector: text, origin: z.url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; }) }).strict().optional(),
    baseUrl: z.url().refine((url) => { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password; }),
    identities: z.array(z.object({ id, expectedUser: text, userSelector: text }).strict()).max(5),
    scenarios: z.array(z.object({ name: text, identity: id,
      category: z.enum(['journey', 'authorization', 'persistence', 'error-handling']),
      criterion: z.number().int().nonnegative(), states: z.array(z.enum(['loading', 'empty', 'validation', 'failure', 'recovery', 'success'])).length(1), steps: z.array(step).min(1).max(40),
    }).strict()).max(50),
  }).strict(),
}).strict().superRefine((plan, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (plan.owner === plan.qaOwner) fail('Delivery owner and QA reviewer must be different agents');
  if (plan.verification.api) {
    if (plan.acceptanceProfile !== 'functional-development') fail('API-only acceptance currently requires explicit functional-development scope');
    if (plan.verification.identities.length || plan.verification.scenarios.length || plan.verification.frame || plan.verification.copilotChecks) fail('API-only verification cannot include browser or Copilot verification');
    for (const category of ['journey', 'authorization', 'persistence', 'error-handling']) if (!plan.verification.api.checks.some((check) => check.category === category)) fail(`Missing API ${category} verification`);
    for (const check of plan.verification.api.checks) if (check.criterion >= plan.acceptanceCriteria.length) fail('API check refers to an unknown acceptance criterion');
    plan.acceptanceCriteria.forEach((_, criterion) => { if (!plan.verification.api!.checks.some((check) => check.criterion === criterion)) fail(`Acceptance criterion ${criterion} has no API test`); });
    return;
  }
  if (!plan.verification.identities.length || plan.verification.scenarios.length < 6) fail('Browser verification requires identities and at least six scenarios');
  const identities = plan.verification.identities.map((identity) => identity.id);
  if (new Set(identities).size !== identities.length || new Set(plan.verification.identities.map((identity) => identity.expectedUser.toLowerCase())).size !== identities.length) fail('Test identities must be distinct');
  const scenarios = plan.verification.scenarios;
  for (const check of plan.verification.copilotChecks ?? []) {
    if (check.channelUrl !== plan.verification.baseUrl) fail('Copilot tests must exercise the approved published channel URL');
    if (new Set(check.cases.map((item) => item.scenario)).size !== check.cases.length) fail('Copilot cases require distinct conversation scenarios');
    const channel = new URL(check.channelUrl);
    if (['copilotstudio.microsoft.com', 'powerva.microsoft.com'].includes(channel.hostname) && !channel.pathname.includes('/webchat')) fail('Use the published Copilot channel, not the Studio authoring/test pane');
    for (const kind of ['grounding', 'fallback', 'tool-action', 'authorization', 'safety', 'multi-turn']) if (!check.cases.some((item) => item.kind === kind)) fail(`Missing Copilot ${kind} case`);
    for (const item of check.cases) {
      const scenario = scenarios.find((scenario) => scenario.name === item.scenario);
      if (!scenario) { fail('Copilot case refers to an unknown browser scenario'); continue; }
      if (!scenario.steps.some((step) => step.action === 'fill')) fail('Copilot cases must send a test message');
      if (item.kind === 'authorization' && scenario.category !== 'authorization') fail('Copilot authorization case requires an authorization scenario');
      if (item.kind === 'multi-turn' && (scenario.steps.filter((step) => step.action === 'fill').length < 2 || scenario.steps.filter((step) => step.action === 'text').length < 2)) fail('Copilot multi-turn case must send and assert at least two messages');
    }
  }
  for (const state of ['loading', 'empty', 'validation', 'failure', 'recovery', 'success']) if (!scenarios.some((s) => s.states.includes(state as typeof s.states[number]))) fail(`Missing UX state: ${state}`);
  if (!scenarios.some((s) => s.steps.some((step) => step.action === 'press'))) fail('At least one keyboard usability task is required');
  for (const category of ['journey', 'authorization', 'persistence', 'error-handling']) if (!scenarios.some((s) => s.category === category)) fail(`Missing ${category} verification`);
  for (const s of scenarios) {
    if (!identities.includes(s.identity) || s.criterion >= plan.acceptanceCriteria.length) fail('Scenario refers to an unknown identity or acceptance criterion');
    if (!s.steps.some((step) => step.action === 'text')) fail('Every scenario needs an observable assertion');
    if (s.steps.some((step) => step.action === 'goto' && (step.path.startsWith('//') || step.path.includes('\\')))) fail('Navigation must stay on the approved site');
    if (s.category === 'persistence' && !s.steps.some((step) => step.action === 'reload')) fail('Persistence verification must reload');
  }
  if (plan.acceptanceProfile !== 'functional-development' && (identities.length < 2 || new Set(scenarios.map((s) => s.identity)).size < 2)) fail('Production verification must exercise at least two distinct identities');
  plan.acceptanceCriteria.forEach((_, index) => { if (!scenarios.some((s) => s.criterion === index)) fail(`Acceptance criterion ${index} has no test`); });
});
export type ReleasePlan = z.infer<typeof releasePlanSchema>;
export function acceptanceScope(plan: Pick<ReleasePlan, 'acceptanceProfile'>) {
  const profile = plan.acceptanceProfile ?? 'production';
  return { profile, limitations: profile === 'functional-development'
    ? ['Functional development validation only; production readiness and employee/approver permission isolation are not certified.'] : [] };
}
