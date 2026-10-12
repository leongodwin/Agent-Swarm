import { expect, it, vi } from 'vitest';
import { mapTargetComponents, reconcileWorkflowAction, verifyConnectionReference, verifyMappedCanvasUrls, verifyTarget, type Request } from './targetOperations.ts';
import type { DeliveryRun } from '../shared/delivery.ts';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const run = (): DeliveryRun => ({ id: 'run', repoId: 'repo', head: 'commit', environmentUrl: 'https://example.com', phase: 'deploying', startedAt: new Date().toISOString(), appUrls: [], evidence: [], log: [] });
const action = { id: 'activate', type: 'workflow-state', component: 'approval', state: 'active' } as const;
const component = { key: 'approval', kind: 'workflow', id } as const;

const bindingAction = { id: 'check-dataverse', type: 'connection-reference-check', component: 'dataverse', connectionId: 'shared-dataverse-real', connectorId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps' } as const;
const bindingComponent = { key: 'dataverse', kind: 'connection-reference', id } as const;
it('maps connection references by logical name within the exact solution', async () => {
  const request = vi.fn<Request>(async (_method, resource) => resource.startsWith('solutions?') ? { value: [{ solutionid: other }] } : resource.startsWith('solutioncomponents?') ? { value: [{ objectid: id, componenttype: 10039 }] } : { value: [{ connectionreferenceid: id }] });
  expect(await mapTargetComponents(request, 'Expense', [{ ...bindingComponent, logicalName: 'exp_dataverse' }])).toEqual([bindingComponent]);
  expect(decodeURIComponent(request.mock.calls[2][1])).toContain("connectionreferencelogicalname eq 'exp_dataverse'");
  await expect(mapTargetComponents(async (method, resource, body) => resource.startsWith('solutioncomponents?') ? { value: [] } : request(method, resource, body), 'Expense', [{ ...bindingComponent, logicalName: 'exp_dataverse' }])).rejects.toThrow('outside');
});
it('checks binding without mutations, catches later drift and recovers from a corrected binding', async () => {
  let connectionid: string | null = bindingAction.connectionId;
  const request = vi.fn<Request>(async () => ({ connectionid, connectorid: bindingAction.connectorId, statecode: 0 }));
  const state = run(); const save = vi.fn(async () => {}); const owned = vi.fn(async () => {});
  await verifyConnectionReference(bindingAction, bindingComponent, request, state, save, owned);
  expect(state.operations![0].status).toBe('verified');
  connectionid = null;
  await expect(verifyConnectionReference(bindingAction, bindingComponent, request, state, save, owned)).rejects.toThrow('binding is missing');
  expect(state.operations![0].status).toBe('unknown');
  connectionid = bindingAction.connectionId;
  await verifyConnectionReference(bindingAction, bindingComponent, request, state, save, owned);
  expect(state.operations![0].status).toBe('verified');
  expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  await expect(verifyConnectionReference({ ...bindingAction, connectionId: 'changed' }, bindingComponent, request, state, save, owned)).rejects.toThrow('create a new release');
});
it('blocks wrong connector, inactive reference and lost ownership without issuing writes', async () => {
  for (const row of [{ connectionid: bindingAction.connectionId, connectorid: 'wrong', statecode: 0 }, { connectionid: bindingAction.connectionId, connectorid: bindingAction.connectorId, statecode: 1 }]) {
    await expect(verifyConnectionReference(bindingAction, bindingComponent, async () => row, run(), async () => {}, async () => {})).rejects.toThrow('binding is missing');
  }
  const request = vi.fn<Request>();
  await expect(verifyConnectionReference(bindingAction, bindingComponent, request, run(), async () => {}, async () => { throw new Error('lost ownership'); })).rejects.toThrow('lost ownership');
  expect(request).not.toHaveBeenCalled();
});

it('rejects source Canvas IDs and unrelated hosts in reported app links', () => {
  const mapping = [{ key: 'expenses', kind: 'canvas', id: other, playId: id }] as const;
  expect(() => verifyMappedCanvasUrls([...mapping], [`https://apps.powerapps.com/play/e/environment/a/${id}`])).not.toThrow();
  expect(() => verifyMappedCanvasUrls([...mapping], [`https://apps.powerapps.com/play/${other}`])).toThrow('target Canvas');
  expect(() => verifyMappedCanvasUrls([...mapping], [`https://example.com/play/${id}`])).toThrow('target Canvas');
});

it('rejects the wrong organization or caller', async () => {
  await expect(verifyTarget(async () => ({ OrganizationId: id, UserId: other }), { organizationId: id, userId: id })).rejects.toThrow('approved target');
});
it('maps target component IDs and requires solution membership', async () => {
  const request: Request = async (_method, resource) => resource.startsWith('solutions?') ? { value: [{ solutionid: other }] } : resource.startsWith('solutioncomponents?') ? { value: [{ objectid: id, componenttype: 29 }] } : { value: [{ workflowid: id }] };
  expect(await mapTargetComponents(request, 'Expense', [{ key: 'approval', kind: 'workflow', logicalName: 'approval' }])).toEqual([component]);
  await expect(mapTargetComponents(async (method, resource, body) => resource.startsWith('solutioncomponents?') ? { value: [] } : request(method, resource, body), 'Expense', [{ key: 'approval', kind: 'workflow', logicalName: 'approval' }])).rejects.toThrow('outside');
});
it('rejects ambiguous component lookup', async () => {
  await expect(mapTargetComponents(async () => ({ value: [{ solutionid: id }, { solutionid: other }] }), 'Expense', [])).rejects.toThrow('exactly one');
});
it('maps imported cloud flows without a unique name by packaged workflow GUID and checks membership', async () => {
  const workflow = 'cdd4902c-b1c4-f111-aaaf-7ced8d76eca6';
  const request = vi.fn<Request>(async (_method, resource) => resource.startsWith('solutions?') ? { value: [{ solutionid: other }] } : resource.startsWith('solutioncomponents?') ? { value: [{ objectid: workflow, componenttype: 29 }] } : { value: [{ workflowid: workflow }] });
  expect(await mapTargetComponents(request, 'Expense', [{ key: 'notify', kind: 'cloud-flow', logicalName: workflow }])).toEqual([{ key: 'notify', kind: 'cloud-flow', id: workflow }]);
  const query = decodeURIComponent(request.mock.calls[2][1]);
  expect(query).toContain(`workflowid eq ${workflow} and type eq 1 and category eq 5`);
  await expect(mapTargetComponents(async (method, resource, body) => resource.startsWith('solutioncomponents?') ? { value: [] } : request(method, resource, body), 'Expense', [{ key: 'notify', kind: 'cloud-flow', logicalName: workflow }])).rejects.toThrow('outside');
});
it('reconciles a lost response without repeating the mutation', async () => {
  let active = false;
  const request = vi.fn<Request>(async (method) => {
    if (method === 'PATCH') { active = true; throw new Error('response lost'); }
    return { category: 0, type: 1, statecode: active ? 1 : 0, statuscode: active ? 2 : 1 };
  });
  const state = run(); const save = vi.fn(async () => {}); const owned = vi.fn(async () => {});
  await expect(reconcileWorkflowAction(action, component, request, state, save, owned)).rejects.toThrow('response lost');
  expect(state.operations![0].status).toBe('unknown');
  await reconcileWorkflowAction(action, component, request, state, save, owned);
  expect(state.operations![0].status).toBe('verified');
  expect(request.mock.calls.filter(([method]) => method === 'PATCH')).toHaveLength(1);
  active = false;
  await expect(reconcileWorkflowAction(action, component, request, state, save, owned)).rejects.toThrow('observed drift');
});
it('blocks an unresolved action when its postcondition is absent', async () => {
  const state = run();
  const request = vi.fn<Request>(async (method) => { if (method === 'PATCH') throw new Error('lost'); return { category: 0, type: 1, statecode: 0, statuscode: 1 }; });
  const execute = () => reconcileWorkflowAction(action, component, request, state, async () => {}, async () => {});
  await expect(execute()).rejects.toThrow('lost');
  await expect(execute()).rejects.toThrow('unresolved');
  expect(request.mock.calls.filter(([method]) => method === 'PATCH')).toHaveLength(1);
});
it('skips already satisfied actions and rejects cloud flows and lost ownership', async () => {
  const request = vi.fn<Request>(async () => ({ category: 0, type: 1, statecode: 1, statuscode: 2 }));
  await reconcileWorkflowAction(action, component, request, run(), async () => {}, async () => {});
  expect(request.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
  await expect(reconcileWorkflowAction(action, component, async () => ({ category: 5, type: 1, statecode: 1, statuscode: 2 }), run(), async () => {}, async () => {})).rejects.toThrow('cloud flows');
  await expect(reconcileWorkflowAction(action, component, request, run(), async () => {}, async () => { throw new Error('lost ownership'); })).rejects.toThrow('lost ownership');
});
