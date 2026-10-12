import { expect, it, vi } from 'vitest';
import { reconcileCloudFlow, reconcileCopilot } from './platformLifecycle.ts';
import { verifyCloudFlowRun, flowDefinitionForPreflight, type FlowAdapter } from './flowAdapter.ts';
import type { DeliveryRun } from '../shared/delivery.ts';
const id = '11111111-1111-4111-8111-111111111111';
const identity = { tenantId: id, username: 'maker@example.com', environmentId: id };
const state = (): DeliveryRun => ({ id: 'release-run', repoId: 'repo', head: 'commit', environmentUrl: 'https://target.crm4.dynamics.com', phase: 'deploying', startedAt: new Date(Date.now() - 10000).toISOString(), appUrls: [], evidence: [], log: [] });
const who = { azIdentity: { tenantId: id, user: identity.username }, tokenIdentity: { tenantId: id, username: identity.username }, effectiveConnectivityIdentity: { tenantId: id, username: identity.username }, identityMismatch: false, connectivityIdentityMismatch: false };
const owned = async () => {}, save = async () => {};
it('preflights Flow API readback without mistaking injected connector auth for authored auth', () => {
  const injected = "@parameters('$authentication')";
  const definition = { actions: { Loop: { type: 'Foreach', actions: { Read: { type: 'OpenApiConnection', inputs: { authentication: injected } }, Custom: { type: 'Http', inputs: { authentication: { type: 'ActiveDirectoryOAuth' } } }, Unexpected: { type: 'OpenApiConnection', inputs: { authentication: 'custom-auth' } } } } } };
  const result: any = flowDefinitionForPreflight(definition);
  expect(result.actions.Loop.actions.Read.inputs).not.toHaveProperty('authentication');
  expect(result.actions.Loop.actions.Custom.inputs.authentication).toEqual({ type: 'ActiveDirectoryOAuth' });
  expect(result.actions.Loop.actions.Unexpected.inputs.authentication).toBe('custom-auth');
  expect(definition.actions.Loop.actions.Read.inputs.authentication).toBe(injected);
});
it('reconciles a lost cloud-flow activation response without repeating it', async () => {
  let active = false;
  const call = vi.fn<FlowAdapter['call']>(async (tool, args) => {
    if (tool === 'whoami') return who;
    expect(args.env).toBe(id);
    if (tool === 'get_flow_context') return { workflowId: id, inSolution: true, solutionUniqueName: 'Active', isManaged: false, category: 5, warning: null };
    if (tool === 'get_flow') return args.path === 'properties' ? { definition: {}, connectionReferences: {} } : active ? 'Started' : 'Stopped';
    if (tool === 'preflight_flow') return { overall: 'ready' };
    if (tool === 'publish_flow') { active = true; throw new Error('response lost'); }
    throw new Error('Unexpected tool');
  });
  const adapter = { call, close: async () => {} }; const run = state();
  const action = { id: 'enable', type: 'cloud-flow-state', component: 'flow', state: 'active', forceManaged: false } as const;
  const component = { id, key: 'flow', kind: 'cloud-flow' } as const;
  await expect(reconcileCloudFlow(action, component, adapter, identity, 'Expense', run, save, owned)).rejects.toThrow('response lost');
  await reconcileCloudFlow(action, component, adapter, identity, 'Expense', run, save, owned);
  expect(call.mock.calls.filter(([tool]) => tool === 'publish_flow')).toHaveLength(1);
  expect(run.operations![0].status).toBe('verified');
  active = false;
  await expect(reconcileCloudFlow(action, component, adapter, identity, 'Expense', run, save, owned)).rejects.toThrow('drift');
});
it('requires release-correlated action output instead of unrelated successful activity', async () => {
  const run = state(); const check = { component: 'flow', action: 'Audit', correlationPointer: ['body', 'releaseId'], assertions: [{ pointer: ['body', 'saved'], equals: true }] };
  const call = vi.fn<FlowAdapter['call']>(async (tool, args) => tool === 'get_run_history' ? [{ name: 'unrelated', status: 'Succeeded', startTime: new Date().toISOString() }, { name: 'ours', status: 'Succeeded', startTime: new Date().toISOString() }] : { content: { body: { releaseId: args.run === 'ours' ? run.id : 'other', saved: true } } });
  const result = await verifyCloudFlowRun({ call, close: owned }, id, id, run.id, run.startedAt, check);
  expect(result.runId).toBe('ours');
  call.mockImplementation(async (tool) => tool === 'get_run_history' ? [{ name: 'unrelated', status: 'Succeeded', startTime: new Date().toISOString() }] : { content: { body: { releaseId: 'other', saved: true } } });
  await expect(verifyCloudFlowRun({ call, close: owned }, id, id, run.id, run.startedAt, check)).rejects.toThrow('No fresh');
});
it('observes fresh Copilot publication and recovers a lost response without republishing', async () => {
  const run = state(); let published: string | null = null;
  const request = async () => ({ statecode: 0, statuscode: 1, publishedon: published });
  const command = vi.fn(async (_executable: string, args: string[]) => { expect(args).toContain(run.environmentUrl); expect(args).toContain(id); published = new Date().toISOString(); throw new Error('response lost'); });
  const action = { type: 'copilot-publish', id: 'publish', component: 'agent' } as const, component = { id, key: 'agent', kind: 'copilot' } as const;
  await expect(reconcileCopilot(action, component, request, command, run, save, owned)).rejects.toThrow('response lost');
  await reconcileCopilot(action, component, request, command, run, save, owned);
  expect(command).toHaveBeenCalledTimes(1); expect(run.operations![0].status).toBe('verified');
});
it('does not treat provisioning or an old publication as delivery', async () => {
  const run = state(); const command = vi.fn(async () => 'provisioned');
  await expect(reconcileCopilot({ type: 'copilot-publish', id: 'publish', component: 'agent' }, { id, key: 'agent', kind: 'copilot' }, async () => ({ statecode: 0, statuscode: 1, publishedon: '2020-01-01T00:00:00Z' }), command, run, save, owned)).rejects.toThrow('postcondition');
  expect(run.operations![0].status).toBe('unknown');
});
