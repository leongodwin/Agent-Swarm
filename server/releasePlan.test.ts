import { expect, it } from 'vitest';
import { releasePlanSchema, acceptanceScope } from './releasePlan.ts';
const states = ['loading', 'empty', 'validation', 'failure', 'recovery', 'success'];
const categories = ['journey', 'journey', 'error-handling', 'authorization', 'persistence', 'journey'];
function plan() { return { name: 'Scoped release', owner: 'author', qaOwner: 'qa', requiredIssues: [1], components: ['app'], acceptanceCriteria: ['End-to-end task'],
  quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['worker'] },
  verification: { baseUrl: 'https://app.example.test', identities: [{ id: 'leon', expectedUser: 'leon@example.test', userSelector: '#user' }],
    scenarios: states.map((state, i) => ({ name: state, states: [state], category: categories[i], identity: 'leon', criterion: 0,
      steps: [{ action: 'press', selector: '#result', key: 'Tab' }, ...(i === 4 ? [{ action: 'reload' }] : []), { action: 'text', selector: '#result', contains: 'Expected result' }] })) } }; }
it('allows one identity only for explicitly scoped development validation and exposes its limitations', () => {
  const input = plan(); expect(releasePlanSchema.safeParse(input).success).toBe(false);
  expect(releasePlanSchema.safeParse({ ...input, acceptanceProfile: 'production' }).success).toBe(false);
  const parsed = releasePlanSchema.parse({ ...input, acceptanceProfile: 'functional-development' });
  expect(acceptanceScope(parsed).limitations.join()).toContain('permission isolation are not certified');
});
it('keeps old strict plans and their serialized shape unchanged', () => {
  const input = plan(); input.verification.identities.push({ id: 'approver', expectedUser: 'approver@example.test', userSelector: '#user' });
  input.verification.scenarios[1].identity = 'approver';
  expect(releasePlanSchema.parse(input)).toEqual(input);
  expect(acceptanceScope(releasePlanSchema.parse(input)).profile).toBe('production');
});
it('never relaxes independent review, criteria or distinct account declarations for development', () => {
  const input = { ...plan(), acceptanceProfile: 'functional-development' };
  expect(releasePlanSchema.safeParse({ ...input, qaOwner: input.owner }).success).toBe(false);
  expect(releasePlanSchema.safeParse({ ...input, acceptanceCriteria: ['Task', 'Uncovered criterion'] }).success).toBe(false);
  input.verification.identities.push({ id: 'another-id', expectedUser: 'LEON@example.test', userSelector: '#user' });
  expect(releasePlanSchema.safeParse(input).success).toBe(false);
});
it('requires distinct live conversation cases, published channels and multiple asserted turns for Copilot', () => {
  const input = { ...plan(), acceptanceProfile: 'functional-development', verification: { ...plan().verification,
    scenarios: plan().verification.scenarios.map((scenario) => ({ ...scenario, steps: [{ action: 'fill', selector: '#prompt', value: 'Synthetic test question' }, ...scenario.steps,
      { action: 'fill', selector: '#prompt', value: 'Follow-up question' }, { action: 'text', selector: '#reply', contains: 'Expected follow-up' }] })),
    copilotChecks: [{ component: 'agent', channelUrl: 'https://app.example.test', cases: ['grounding', 'fallback', 'tool-action', 'authorization', 'safety', 'multi-turn'].map((kind, i) => ({ kind, scenario: states[i] })) }] } };
  expect(releasePlanSchema.safeParse(input).success).toBe(true);
  input.verification.copilotChecks[0].cases[5].scenario = states[0];
  expect(releasePlanSchema.safeParse(input).success).toBe(false);
});
