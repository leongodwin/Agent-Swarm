import {functionalShowcaseSchema,functionalLimits} from '../shared/functionalShowcase.ts';
import {nativeDeniedCheckSchema} from '../shared/nativeQa.ts';
import {qualityContractSchema} from '../shared/qualityEvidence.ts';
import {firstSliceSchema} from '../shared/firstSlice.ts';
import { z } from 'zod';
import { cloudFlowCheckSchema } from './flowAdapter.ts';
import { apiVerificationSchema } from './apiVerification.ts';
import {headlessFlowSchema} from './headlessFlowVerification.ts';
import {hldResultSchema} from '../shared/hldArtifact.ts';
import {recordReferenceSchema} from '../shared/deliveryRecord.ts';
import {pinnedSourceSchema} from './pinnedPreparationContracts.ts';
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
  preparation:pinnedSourceSchema.optional(),
  // Optional only for loading historical state. New release creation requires it.
  architecture: z.strictObject({docId:hldResultSchema.shape.docId,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
  deliveryRecord: recordReferenceSchema.extend({purpose:z.enum(['slice','expansion'])}).optional(),
  firstSlice:firstSliceSchema.optional(),
  qualityEvidence:qualityContractSchema.optional(),
  name: text, owner: id, qaOwner: id, requiredIssues: z.array(z.number().int().positive()).min(1).max(100),
  components: z.array(text).min(1).max(100), acceptanceCriteria: z.array(text).min(1).max(100),
  quality: z.object({ maxTaskDurationMs: z.number().int().min(1000).max(120000), maxVerificationDurationMs:z.number().int().min(1000).max(3600000).optional(), maxSeriousAccessibilityIssues: z.literal(0) }).strict(),
  monitoring: z.object({ intervalMinutes: z.number().int().min(5).max(1440), criticalProbeIds: z.array(text).min(1).max(20) }).strict(),
  verification: z.object({
    browserSession:z.literal('connected-extension').optional(),
    functionalShowcase:functionalShowcaseSchema.optional(),
    nativeDeniedChecks:z.array(nativeDeniedCheckSchema).min(1).max(20).refine(rows=>new Set(rows.map(r=>r.testName)).size===rows.length,'Duplicate native denied checks').optional(),
    api: apiVerificationSchema.optional(),
    headlessFlow:headlessFlowSchema.optional(),
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
  if(plan.verification.browserSession&&(plan.acceptanceProfile!=='functional-development'||plan.verification.api||plan.verification.copilotChecks||new Set(plan.verification.identities.map(i=>i.expectedUser.toLowerCase())).size!==1||plan.verification.scenarios.some(s=>s.steps.some(step=>step.action==='upload'))))fail('Connected-browser verification requires single-user functional development without API, Copilot or uploads');
  if(plan.qualityEvidence&&!plan.deliveryRecord)fail('Quality evidence requires a pinned delivery record');
  if(plan.qualityEvidence&&plan.verification.api)fail('Quality acceptance requires a runner-owned denied-action adapter; API-only evidence is insufficient');
  if(plan.firstSlice&&plan.deliveryRecord?.purpose!=='slice')fail('First-slice execution requires a pinned slice release');
  if(plan.verification.api&&plan.verification.nativeDeniedChecks)fail('Native denied checks require browser and native verification together');
  for(const check of plan.verification.nativeDeniedChecks??[]){if(check.contract.observationWindowMs+60000>plan.quality.maxTaskDurationMs)fail('Native denied observation and request budget exceed the approved task duration');const test=plan.verification.scenarios.find(t=>t.name===check.testName);if(!test||test.category!=='authorization'||test.identity!==check.deniedIdentity||!plan.verification.identities.some(i=>i.id===check.deniedIdentity&&i.expectedUser.toLowerCase()===check.deniedUsername.toLowerCase())||!plan.verification.identities.some(i=>i.id===check.observerIdentity&&i.id!==check.deniedIdentity&&i.expectedUser.toLowerCase()===check.observerUsername.toLowerCase()))fail('Native denied check identity or scenario binding differs');}
  const testNames=(plan.verification.headlessFlow?.checks??plan.verification.api?.checks??plan.verification.scenarios).map(t=>t.name);
  if((plan.firstSlice||plan.qualityEvidence)&&new Set(testNames).size!==testNames.length)fail('Verification test names must be unique');
  for(const c of plan.firstSlice?.cases??[])if(!testNames.includes(c.testName))fail('First-slice case refers to an unknown executable test');
  if (plan.owner === plan.qaOwner) fail('Delivery owner and QA reviewer must be different agents');
  if(plan.verification.headlessFlow){
    if(plan.verification.headlessFlow.allowDispatch&&plan.verification.headlessFlow.dispatchKey!==plan.deliveryRecord?.id)fail('Dispatch claim must bind the delivery record identity across revisions and retries');
    if(plan.verification.api||plan.verification.identities.length||plan.verification.scenarios.length||plan.verification.browserSession||plan.verification.frame||plan.verification.nativeDeniedChecks||plan.verification.copilotChecks)fail('Headless flow acceptance cannot mix UI, Dataverse API or other identity adapters');
    for(const check of plan.verification.headlessFlow.checks)if(check.criterion>=plan.acceptanceCriteria.length)fail('Headless check has an unknown acceptance criterion');
    plan.acceptanceCriteria.forEach((_,i)=>{if(!plan.verification.headlessFlow!.checks.some(c=>c.criterion===i))fail('Headless acceptance criterion has no executable check');});
    return;
  }
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
  if (new Set(identities).size !== identities.length) fail('Test identities must be distinct');
  const users = new Map<string, typeof plan.verification.identities>();
  for (const identity of plan.verification.identities) {
    const user=identity.expectedUser.toLowerCase();users.set(user,[...(users.get(user)??[]),identity]);
  }
  for (const [user, entries] of users) if (entries.length>1) {
    // A development-only native test can exercise one real user through two
    // distinct selected-permission apps. These are not two employee identities.
    const ids=new Set(entries.map(entry=>entry.id));
    const selectedAppPair=entries.length===2&&[...(plan.verification.nativeDeniedChecks??[]),...(plan.verification.functionalShowcase?[plan.verification.functionalShowcase.rejection]:[])].some(check=>check.authorizationBoundary&&ids.has(check.deniedIdentity)&&ids.has(check.observerIdentity)&&check.deniedUsername.toLowerCase()===user&&check.observerUsername.toLowerCase()===user);
    if(plan.acceptanceProfile!=='functional-development'||!selectedAppPair)fail('Test identities must be distinct');
  }
  const functional=plan.verification.functionalShowcase;
  if(functional){
    if(plan.acceptanceProfile!=='functional-development'||plan.verification.api||plan.verification.nativeDeniedChecks||!plan.quality.maxVerificationDurationMs)fail('Functional showcase requires its explicit development scope, bounded suite and separate limited rejection contract');
    const rejection=functional.rejection,scenario=plan.verification.scenarios.find(s=>s.name===rejection.testName);
    if(!scenario||scenario.category!=='authorization'||scenario.identity!==rejection.deniedIdentity)fail('Functional rejection must bind an exact authorization scenario');
    for(const [role,username] of [[rejection.deniedIdentity,rejection.deniedUsername],[rejection.observerIdentity,rejection.observerUsername]])if(!plan.verification.identities.some(i=>i.id===role&&i.expectedUser.toLowerCase()===username.toLowerCase()))fail('Functional rejection identity differs');
    if(JSON.stringify(functional.recovery.target)!==JSON.stringify(rejection.target))fail('Functional recovery/rejection must use the same dedicated target');
    if(!plan.verification.scenarios.some(s=>s.name===functional.recovery.failureTestName&&s.states.includes('failure'))||!plan.verification.scenarios.some(s=>s.name===functional.recovery.recoveryTestName&&s.states.includes('recovery')))fail('Functional recovery needs exact failure/recovery browser cases');
    if(rejection.contract.observationWindowMs+60000>plan.quality.maxTaskDurationMs)fail('Functional rejection exceeds its approved task deadline');
    const ordered=[functional.duplicate.beforeTestName,functional.duplicate.testName,functional.recovery.failureTestName,functional.recovery.recoveryTestName];
    if(new Set(ordered).size!==4||ordered.some(name=>plan.verification.scenarios.filter(s=>s.name===name&&s.identity===rejection.observerIdentity).length!==1)||plan.verification.scenarios.findIndex(s=>s.name===ordered[0])>=plan.verification.scenarios.findIndex(s=>s.name===ordered[1])||plan.verification.scenarios.findIndex(s=>s.name===ordered[2])>=plan.verification.scenarios.findIndex(s=>s.name===ordered[3]))fail('Functional duplicate and recovery require ordered distinct writer scenarios');
    if(plan.quality.maxVerificationDurationMs!==undefined&&plan.quality.maxVerificationDurationMs<plan.quality.maxTaskDurationMs)fail('Functional suite cannot be shorter than one approved user task');
    if(new URL(plan.verification.baseUrl).searchParams.has('qaRunId'))fail('Functional correlation parameter is reserved for the runner');
  }
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
export function acceptanceScope(plan: Pick<ReleasePlan, 'acceptanceProfile'> & {verification?:ReleasePlan['verification']}) {
  const profile = plan.acceptanceProfile ?? 'production';
  return { profile, limitations: profile === 'functional-development'
    ? ['Functional development validation only; production readiness and employee/approver permission isolation are not certified.',...(plan.verification?.functionalShowcase?functionalLimits:[])] : [] };
}
