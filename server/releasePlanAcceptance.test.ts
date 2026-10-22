import { expect, it } from 'vitest';
import { releasePlanSchema } from './releasePlan.ts';
import { qualityContract } from './testFixtures/quality.ts';

function plan() {
  return { name: 'Synthetic scoped release', owner: 'dev', qaOwner: 'qa', requiredIssues: [1], components: ['app'], acceptanceCriteria: ['Task persists after reload'], acceptanceProfile: 'functional-development',
    quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['worker'] },
    verification: { baseUrl: 'https://app.example.test', identities: [{ id: 'employee', expectedUser: 'employee@example.test', userSelector: '#user' }],
      scenarios: ['loading', 'empty', 'validation', 'failure', 'recovery', 'success'].map((state, i) => ({ name: state, states: [state], category: ['journey', 'journey', 'error-handling', 'authorization', 'persistence', 'journey'][i], identity: 'employee', criterion: 0,
        steps: [{ action: 'press', selector: '#result', key: 'Tab' }, ...(i === 4 ? [{ action: 'reload' }] : []), { action: 'text', selector: '#result', contains: 'Expected observable result' }] })) } };
}
function messages() { const p = plan(); for (const s of p.verification.scenarios) s.steps.push({ action: 'fill', selector: '#message', value: 'Synthetic message' } as never, { action: 'fill', selector: '#message', value: 'Synthetic follow-up' } as never, { action: 'text', selector: '#reply', contains: 'Follow-up outcome' }); return p; }
function copilot() { const p = messages(); return { ...p, verification: { ...p.verification, copilotChecks: [{ component: 'agent', channelUrl: p.verification.baseUrl, cases: ['grounding', 'fallback', 'tool-action', 'authorization', 'safety', 'multi-turn'].map((kind, n) => ({ kind, scenario: p.verification.scenarios[n].name })) }] } }; }
function rejection(input: unknown, message: string) { const parsed = releasePlanSchema.safeParse(input); expect(parsed.success).toBe(false); if (parsed.success) throw new Error('Unsafe release was accepted'); expect(parsed.error.issues.map(issue => issue.message).join('\n')).toContain(message); }

it.each(['foreign-identity', 'foreign-criterion', 'no-assertion', 'no-reload', 'no-keyboard', 'missing-state', 'missing-category', 'uncovered-criterion', 'duplicate-identity', 'no-scenarios', 'foreign-navigation', 'escaped-navigation'] as const)('denies browser acceptance that fails %s evidence obligations', mode => {
  const p = plan();
  if (mode === 'foreign-identity') p.verification.scenarios[0].identity = 'foreign';
  if (mode === 'foreign-criterion') p.verification.scenarios[0].criterion = 1;
  if (mode === 'no-assertion') p.verification.scenarios[0].steps = p.verification.scenarios[0].steps.filter(step => step.action !== 'text');
  if (mode === 'no-reload') p.verification.scenarios[4].steps = p.verification.scenarios[4].steps.filter(step => step.action !== 'reload');
  if (mode === 'no-keyboard') for (const s of p.verification.scenarios) s.steps = s.steps.filter(step => step.action !== 'press');
  if (mode === 'missing-state') p.verification.scenarios[0].states = ['empty'];
  if (mode === 'missing-category') p.verification.scenarios[3].category = 'journey';
  if (mode === 'uncovered-criterion') p.acceptanceCriteria.push('A second required journey');
  if (mode === 'duplicate-identity') p.verification.identities.push({ ...p.verification.identities[0] });
  if (mode === 'no-scenarios') p.verification.scenarios = [];
  if (mode.endsWith('navigation')) p.verification.scenarios[0].steps.push({ action: 'goto', path: mode === 'foreign-navigation' ? '//foreign.example.test' : '/\\foreign.example.test' } as never);
  const expected = mode === 'foreign-identity' || mode === 'foreign-criterion' ? 'unknown identity or acceptance criterion' : mode === 'no-assertion' ? 'observable assertion' : mode === 'no-reload' ? 'must reload' : mode === 'no-keyboard' ? 'keyboard usability' : mode === 'missing-state' ? 'Missing UX state' : mode === 'missing-category' ? 'Missing authorization' : mode === 'uncovered-criterion' ? 'has no test' : mode === 'duplicate-identity' ? 'identities must be distinct' : mode === 'no-scenarios' ? 'at least six scenarios' : 'Navigation must stay';
  rejection(p, expected);
});
it.each(['wrong-channel', 'authoring-pane', 'missing-kind', 'missing-scenario', 'missing-message', 'wrong-authorization', 'short-conversation'] as const)('denies Copilot %s contracts before any runtime authoring or deployment', mode => {
  const p = copilot(), check = p.verification.copilotChecks[0];
  if (mode === 'wrong-channel') check.channelUrl = 'https://foreign.example.test';
  if (mode === 'authoring-pane') p.verification.baseUrl = check.channelUrl = 'https://copilotstudio.microsoft.com/environments/synthetic/bots/test';
  if (mode === 'missing-kind') check.cases[0].kind = 'fallback';
  if (mode === 'missing-scenario') check.cases[0].scenario = 'unknown';
  if (mode === 'missing-message') p.verification.scenarios[0].steps = p.verification.scenarios[0].steps.filter(step => step.action !== 'fill');
  if (mode === 'wrong-authorization') { check.cases[3].scenario = 'loading'; check.cases[0].scenario = 'failure'; }
  if (mode === 'short-conversation') p.verification.scenarios[5].steps = p.verification.scenarios[5].steps.filter(step => step.action !== 'fill');
  rejection(p, mode === 'wrong-channel' ? 'approved published channel' : mode === 'authoring-pane' ? 'Studio authoring/test pane' : mode === 'missing-kind' ? 'Missing Copilot grounding' : mode === 'missing-scenario' ? 'unknown browser scenario' : mode === 'missing-message' ? 'send a test message' : mode === 'wrong-authorization' ? 'requires an authorization scenario' : 'at least two messages');
});
it.each(['http://host.test', 'https://user:password@host.test', 'https://host.test/embedded', 'https://host.test/?token=synthetic', 'https://host.test/#frame'])('refuses untrusted embedded-frame origin %s', origin => {
  expect(releasePlanSchema.safeParse({ ...plan(), verification: { ...plan().verification, frame: { selector: '#embedded', origin } } }).success).toBe(false);
});
it('accepts a bounded same-site frame and verifies that quality evidence cannot float free of its record', () => {
  const p = plan(); expect(releasePlanSchema.safeParse({ ...p, verification: { ...p.verification, frame: { selector: '#embedded', origin: 'https://embedded.example.test' } } }).success).toBe(true);
  rejection({ ...p, qualityEvidence: qualityContract() }, 'requires a pinned delivery record');
});
it('rejects API evidence that attempts to widen into UI, production, unknown criteria or uncovered required journeys', () => {
  const id = '11111111-1111-4111-8111-111111111111', p = plan();
  const api = { binding: { organizationId: id, userId: id }, checks: ['journey', 'authorization', 'persistence', 'error-handling'].map(category => ({ name: `Synthetic ${category}`, category, criterion: 0, resource: 'WhoAmI', assertions: [{ pointer: ['UserId'], equals: id }] })) };
  const backend = { ...p, verification: { baseUrl: 'https://example.crm.dynamics.com', identities: [], scenarios: [], api } };
  expect(releasePlanSchema.safeParse(backend).success).toBe(true);
  rejection({ ...backend, acceptanceProfile: 'production' }, 'explicit functional-development');
  rejection({ ...backend, verification: { ...backend.verification, frame: { selector: '#frame', origin: 'https://frame.example.test' } } }, 'cannot include browser');
  rejection({ ...backend, acceptanceCriteria: [...p.acceptanceCriteria, 'Required second journey'] }, 'has no API test');
  rejection({ ...backend, verification: { ...backend.verification, api: { ...api, checks: api.checks.map(check => ({ ...check, criterion: 2 })) } } }, 'unknown acceptance criterion');
  rejection({ ...backend, verification: { ...backend.verification, api: { ...api, checks: api.checks.filter(check => check.category !== 'authorization') } } }, 'Missing API authorization');
  rejection({ ...backend, qualityEvidence: qualityContract() }, 'denied-action adapter');
});
it.each(['unpinned', 'duplicate-test-names', 'unknown-executable-test'] as const)('refuses first-slice %s before assigning any delivery work', mode => {
  const p = plan(), firstSlice = { schemaVersion: 1, components: [{ componentId: 'data', targetKey: 'reports', platform: 'dataverse' }], cases: ['loading', 'failure', 'validation'].map((testName, n) => ({ checkId: 'runtime', scenarioId: ['happy', 'denied', 'failure'][n], testName })) };
  const deliveryRecord = { id: '11111111-1111-4111-8111-111111111111', revision: 1, sha256: 'a'.repeat(64), purpose: 'slice' };
  if (mode === 'duplicate-test-names') p.verification.scenarios[1].name = 'loading';
  if (mode === 'unknown-executable-test') firstSlice.cases[0].testName = 'unknown runtime test';
  const input = { ...p, firstSlice, ...(mode === 'unpinned' ? {} : { deliveryRecord }) };
  rejection(input, mode === 'unpinned' ? 'requires a pinned slice' : mode === 'duplicate-test-names' ? 'test names must be unique' : 'unknown executable test');
});
