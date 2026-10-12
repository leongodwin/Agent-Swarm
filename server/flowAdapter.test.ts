import { expect, it, vi } from 'vitest';
import { verifyCloudFlowBindings, verifyCloudFlowActivationBindings } from './flowAdapter.ts';
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
it('requires live reference verification before activating an imported embedded reference, and runtime resolution afterward', async () => {
  const imported = adapter({ dataverse: { ...reference, connectionName: undefined, source: 'Embedded' } });
  const verify = vi.fn(async () => {});
  await expect(verifyCloudFlowBindings(imported, 'environment', 'flow', components, actions)).rejects.toThrow('unresolved');
  expect(await verifyCloudFlowActivationBindings(imported, 'environment', 'flow', components, actions, verify)).toHaveLength(1);
  expect(verify).toHaveBeenCalledExactlyOnceWith(actions[0]);
  await expect(verifyCloudFlowBindings(imported, 'environment', 'flow', components, actions)).rejects.toThrow('unresolved');
  await expect(verifyCloudFlowActivationBindings(imported, 'environment', 'flow', components, actions, async () => { throw new Error('live reference drift'); })).rejects.toThrow('live reference drift');
  await expect(verifyCloudFlowActivationBindings(adapter({ dataverse: { ...reference, connectionName: undefined, source: 'Invoker' } }), 'environment', 'flow', components, actions, verify)).rejects.toThrow('unresolved');
  await expect(verifyCloudFlowActivationBindings(adapter({ dataverse: { ...reference, source: 'Embedded', connectionName: 'wrong' } }), 'environment', 'flow', components, actions, verify)).rejects.toThrow('approved target binding');
  expect(verify).toHaveBeenCalledTimes(1);
});
