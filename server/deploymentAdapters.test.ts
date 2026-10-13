import { expect, it, vi } from 'vitest';
import { reconcileAdditionalAction, verifyMigrationCompatibility } from './deploymentAdapters.ts';
import type { Request } from './targetOperations.ts';
import type { DeliveryRun } from '../shared/delivery.ts';
const id = '11111111-1111-4111-8111-111111111111';
const run = (): DeliveryRun => ({ id: 'run', repoId: 'repo', head: 'head', environmentUrl: 'https://target.crm.dynamics.com', phase: 'deploying', startedAt: new Date().toISOString(), appUrls: [], evidence: [], log: [] });
const bind = { id: 'bind', type: 'connection-reference-bind', component: 'dataverse', expectedConnectionId: null, connectionId: 'approved', connectorId: 'connector' } as const;
const connection = { key: 'dataverse', kind: 'connection-reference', id } as const;
it('repairs with If-Match and reconciles a lost response without another write', async () => {
  let connectionid: string | null = null;
  const request = vi.fn<Request>(async (method) => { if (method === 'PATCH') { connectionid = 'approved'; throw new Error('response lost'); } return { connectionid, connectorid: 'connector', statecode: 0, '@odata.etag': 'W/"42"' }; });
  const state = run();
  await expect(reconcileAdditionalAction(bind, connection, request, state, async () => {}, async () => {})).rejects.toThrow('response lost');
  expect(request.mock.calls.find(([method]) => method === 'PATCH')?.[3]).toEqual({ 'If-Match': 'W/"42"' });
  await reconcileAdditionalAction(bind, connection, request, state, async () => {}, async () => {});
  expect(request.mock.calls.filter(([method]) => method === 'PATCH')).toHaveLength(1);
  expect(state.operations![0].status).toBe('verified');
  connectionid = 'external-change';
  await expect(reconcileAdditionalAction(bind, connection, request, state, async () => {}, async () => {})).rejects.toThrow('changed since');
});
const table = { key: 'reports', kind: 'dataverse-table', id, logicalName: 'exp_report', entitySet: 'exp_reports', primaryId: 'exp_reportid' } as const;
const schema = { id: 'schema', type: 'schema-check', component: 'reports', columns: [{ name: 'exp_title', type: 'String', required: 'None' }] } as const;
it('checks schema contracts and blocks incompatible pre-import migrations', async () => {
  const attributes = [{ LogicalName: 'exp_title', AttributeType: 'Integer', RequiredLevel: { Value: 'None' } }];
  const request = vi.fn<Request>(async (_method, resource) => ({ value: resource.startsWith('EntityDefinitions?') ? [{ LogicalName:table.logicalName,Attributes: attributes }] : attributes }));
  await expect(verifyMigrationCompatibility([{ ...schema, columns: [...schema.columns] }], [table], request)).rejects.toThrow('Incompatible schema');
  await expect(reconcileAdditionalAction({ ...schema, columns: [...schema.columns] }, table, request, run(), async () => {}, async () => {})).rejects.toThrow('reviewed solution import');
  expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  await expect(verifyMigrationCompatibility([{ ...schema, columns: [...schema.columns] }], [table], async () => ({ value: [] }))).resolves.toBeUndefined();
});
it('binds migration observations to one approved table and rejects missing, mismatched and truncated identities',async()=>{
  const action={...schema,columns:[...schema.columns]};
  const observed={LogicalName:table.logicalName,Attributes:[{LogicalName:'exp_title',AttributeType:'String',RequiredLevel:{Value:'None'}}]};
  const request=vi.fn<Request>(async()=>({value:[observed]}));
  await verifyMigrationCompatibility([action],[{...table,logicalName:table.logicalName.toUpperCase()}],request);
  expect(request.mock.calls.every(([method])=>method==='GET')).toBe(true);
  expect(request.mock.calls[0][1]).not.toContain('$top=');
  for(const response of [{value:[{...observed,LogicalName:'exp_other'}]},{value:[{Attributes:observed.Attributes}]},{value:[observed], '@odata.nextLink':'more'},{value:[{...observed,'Attributes@odata.nextLink':'more'}]},{value:[observed,observed]}])
    await expect(verifyMigrationCompatibility([action],[table],async()=>response)).rejects.toThrow();
  const unused=vi.fn<Request>(async()=>({value:[]}));
  for(const components of [[],[table,table],[{...table,logicalName:"exp_report')?$select=secret"}]])await expect(verifyMigrationCompatibility([action],components,unused)).rejects.toThrow();
  expect(unused).not.toHaveBeenCalled();
});
it('grants only the approved record share and recovers a lost response without another grant', async () => {
  let shared = false;
  const action = { id: 'share', type: 'record-share', component: 'reports', recordId: id, principalId: id, principalType: 'systemuser', expectedRights: [], rights: ['ReadAccess'] } as const;
  const request = vi.fn<Request>(async (method, resource) => {
    if (method === 'POST') { shared = true; throw new Error('response lost'); }
    if (resource.startsWith('systemusers')) return { isdisabled: false };
    if (resource.startsWith('RetrieveShared')) return { PrincipalAccesses: shared ? [{ Principal: { systemuserid: id }, AccessMask: 'ReadAccess' }] : [] };
    return {};
  });
  const state = run(); const execute = () => reconcileAdditionalAction({ ...action, expectedRights: [], rights: ['ReadAccess'] }, table, request, state, async () => {}, async () => {});
  await expect(execute()).rejects.toThrow('response lost'); await execute();
  const writes = request.mock.calls.filter(([method]) => method === 'POST');
  const observePath = request.mock.calls.find(([_method, resource]) => resource.startsWith('RetrieveShared'))![1];
  const literal = JSON.parse(decodeURIComponent(observePath.split('@target=')[1]));
  expect(literal).toEqual({ '@odata.id': `/exp_reports(${id})` });
  expect(writes).toHaveLength(1); expect(writes[0][1]).toBe('GrantAccess');
  expect(writes[0][2]).toMatchObject({ Target: { exp_reportid: id }, PrincipalAccess: { AccessMask: 'ReadAccess' } });
});
it('recognizes the live polymorphic ownerid principal only with the approved entity type', async () => {
  const action = { id: 'share-team', type: 'record-share', component: 'reports', recordId: id, principalId: id, principalType: 'team', expectedRights: [], rights: ['ReadAccess'] } as const;
  const request = vi.fn<Request>(async (_method, resource) => resource.startsWith('teams') ? { teamid: id } : resource.startsWith('RetrieveShared') ? { PrincipalAccesses: [{ Principal: { '@odata.type': '#Microsoft.Dynamics.CRM.team', ownerid: id }, AccessMask: 'ReadAccess' }] } : {});
  const state = run();
  await reconcileAdditionalAction({ ...action, expectedRights: [], rights: ['ReadAccess'] }, table, request, state, async () => {}, async () => {});
  expect(state.operations![0].status).toBe('verified');
  expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
});
