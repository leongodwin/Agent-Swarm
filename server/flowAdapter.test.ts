import { expect, it, vi } from 'vitest';
import { verifyCloudFlowBindings } from './flowAdapter.ts';
import type { TargetAction, TargetComponent } from './targetOperations.ts';

const components: TargetComponent[] = [{ key: 'dataverse', kind: 'connection-reference', logicalName: 'exp_dataverse' }];
const actions: TargetAction[] = [{ id: 'check', type: 'connection-reference-check', component: 'dataverse', connectionId: 'approved', connectorId: 'dataverse-connector' }];
const reference = { connectionName: 'approved', connectionReferenceLogicalName: 'exp_dataverse', id: 'dataverse-connector' };
const adapter = (value: unknown) => ({ call: vi.fn(async () => value), close: vi.fn(async () => {}) });

it('checks every runtime flow reference against approved logical name, connector and connection', async () => {
  const flow = adapter({ dataverse: reference });
  expect(await verifyCloudFlowBindings(flow, 'environment', 'flow', components, actions)).toEqual([{ alias: 'dataverse', component: 'dataverse', connectionId: 'approved', connectorId: 'dataverse-connector' }]);
  expect(flow.call).toHaveBeenCalledWith('get_flow', { env: 'environment', flow: 'flow', path: 'properties.connectionReferences' });
  for (const wrong of [{ ...reference, connectionName: 'different' }, { ...reference, id: 'different' }, { ...reference, connectionReferenceLogicalName: 'unknown' }]) {
    await expect(verifyCloudFlowBindings(adapter({ dataverse: wrong }), 'environment', 'flow', components, actions)).rejects.toThrow('approved target binding');
  }
  await expect(verifyCloudFlowBindings(flow, 'environment', 'flow', components, [])).rejects.toThrow('approved target binding');
});
it('fails closed on unresolved references and permits a flow with no connector dependencies', async () => {
  await expect(verifyCloudFlowBindings(adapter({ dataverse: { id: 'dataverse-connector' } }), 'environment', 'flow', components, actions)).rejects.toThrow();
  expect(await verifyCloudFlowBindings(adapter({}), 'environment', 'flow', [], [])).toEqual([]);
});
