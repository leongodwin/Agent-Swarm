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
it('reconciles declared structures without writes and rejects key drift before/import and after verification',async()=>{
  let status='Active';
  const attribute={LogicalName:'exp_title',AttributeType:'String',RequiredLevel:{Value:'None'}};
  const action={...schema,columns:[...schema.columns],structure:{keys:[{schemaName:'exp_Report_Key',attributes:['exp_title']}]}};
  const request=vi.fn<Request>(async(_method,resource)=>({value:resource.includes('/Keys?')?[{SchemaName:'exp_Report_Key',MetadataId:id,KeyAttributes:['exp_title'],EntityKeyIndexStatus:status}]:resource.startsWith('EntityDefinitions?')?[{LogicalName:table.logicalName,Attributes:[attribute]}]:[attribute]}));
  await verifyMigrationCompatibility([action],[table],request);
  const state=run();await reconcileAdditionalAction(action,table,request,state,async()=>{},async()=>{});expect(state.operations![0].status).toBe('verified');
  status='Failed';await expect(verifyMigrationCompatibility([action],[table],request)).rejects.toThrow('Incompatible schema');
  await expect(reconcileAdditionalAction(action,table,request,state,async()=>{},async()=>{})).rejects.toThrow('verification failed');
  expect(request.mock.calls.every(([method])=>method==='GET')).toBe(true);
});
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
    if (resource.startsWith('systemusers')) return { systemuserid:id,isdisabled: false };
    if (resource.startsWith('RetrieveShared')) return { PrincipalAccesses: shared ? [{ Principal: { systemuserid: id }, AccessMask: 'ReadAccess' }] : [] };
    return {exp_reportid:id};
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
  const request = vi.fn<Request>(async (_method, resource) => resource.startsWith('teams') ? { teamid: id } : resource.startsWith('RetrieveShared') ? { PrincipalAccesses: [{ Principal: { '@odata.type': '#Microsoft.Dynamics.CRM.team', ownerid: id }, AccessMask: 'ReadAccess' }] } : {exp_reportid:id});
  const state = run();
  await reconcileAdditionalAction({ ...action, expectedRights: [], rights: ['ReadAccess'] }, table, request, state, async () => {}, async () => {});
  expect(state.operations![0].status).toBe('verified');
  expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
});
const shareAction={id:'identity-share',type:'record-share' as const,component:'reports',recordId:id,principalId:id,principalType:'systemuser' as const,expectedRights:[],rights:['ReadAccess' as const]};
const shareRow={Principal:{systemuserid:id},AccessMask:'ReadAccess'};
function sharingRequest(inventory:unknown,principal:unknown={systemuserid:id,isdisabled:false},record:unknown={exp_reportid:id}){
  return vi.fn<Request>(async(method,resource)=>{if(method!=='GET')throw new Error('Unexpected mutation');return resource.startsWith('systemusers')?principal:resource.startsWith('RetrieveShared')?inventory:record;});
}
it.each([
  {Principal:{systemuserid:id,'@odata.type':'#Microsoft.Dynamics.CRM.team'},AccessMask:'ReadAccess'},
  {Principal:{systemuserid:id,teamid:id},AccessMask:'ReadAccess'},
  {Principal:{systemuserid:id,ownerid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','@odata.type':'#Microsoft.Dynamics.CRM.systemuser'},AccessMask:'ReadAccess'},
  {Principal:{ownerid:id},AccessMask:'ReadAccess'},
  {Principal:{},AccessMask:'ReadAccess'},
  {Principal:{systemuserid:'invalid'},AccessMask:'ReadAccess'},
  {Principal:{systemuserid:id,'@odata.type':42},AccessMask:'ReadAccess'},
  {Principal:{ownerid:id,'@odata.type':'#Microsoft.Dynamics.CRM.businessunit'},AccessMask:'ReadAccess'},
  {...shareRow,AccessMask:'ReadAccess, None'},
  {...shareRow,AccessMask:'ReadAccess,ReadAccess'},
  {...shareRow,AccessMask:'ReadAccess,'},
  {...shareRow,AccessMask:'ReadAccess,FutureAccess'},
  {...shareRow,AccessMask:''},
])('rejects ambiguous principal or access data before granting: %j',async row=>{
  const request=sharingRequest({PrincipalAccesses:[row]}),state=run();
  await expect(reconcileAdditionalAction(shareAction,table,request,state,async()=>{},async()=>{})).rejects.toThrow();expect(request.mock.calls.every(([method])=>method==='GET')).toBe(true);expect(state.operations).toEqual([]);
});
it.each([{PrincipalAccesses:[shareRow,shareRow]},{PrincipalAccesses:[], '@odata.nextLink':'more'},{PrincipalAccesses:[], 'PrincipalAccesses@odata.nextLink':'more'},{PrincipalAccesses:Array.from({length:5000},()=>shareRow)}])('rejects duplicate or incomplete sharing inventories without writes',async inventory=>{
  const request=sharingRequest(inventory);await expect(reconcileAdditionalAction(shareAction,table,request,run(),async()=>{},async()=>{})).rejects.toThrow();expect(request.mock.calls.every(([method])=>method==='GET')).toBe(true);
});
it.each([
  [{isdisabled:false},{exp_reportid:id}],
  [{systemuserid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',isdisabled:false},{exp_reportid:id}],
  [{systemuserid:id,isdisabled:true},{exp_reportid:id}],
  [{systemuserid:id,isdisabled:false},{}],
  [{systemuserid:id,isdisabled:false},{exp_reportid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}],
])('requires both approved principal and record identity before inspecting shares',async(principal,record)=>{
  const request=sharingRequest({PrincipalAccesses:[]},principal,record);await expect(reconcileAdditionalAction(shareAction,table,request,run(),async()=>{},async()=>{})).rejects.toThrow();expect(request.mock.calls.some(([,resource])=>resource.startsWith('RetrieveShared'))).toBe(false);expect(request.mock.calls.every(([method])=>method==='GET')).toBe(true);
});
it('recognizes consistent declared and explicit identities while keeping excessive rights blocked',async()=>{
  const request=sharingRequest({PrincipalAccesses:[{Principal:{'@odata.type':'#Microsoft.Dynamics.CRM.systemuser',systemuserid:id,ownerid:id},AccessMask:'ReadAccess'}]});
  await reconcileAdditionalAction(shareAction,table,request,run(),async()=>{},async()=>{});expect(request.mock.calls.every(([method])=>method==='GET')).toBe(true);
  const excessive=sharingRequest({PrincipalAccesses:[{...shareRow,AccessMask:'ReadAccess, ShareAccess'}]});await expect(reconcileAdditionalAction(shareAction,table,excessive,run(),async()=>{},async()=>{})).rejects.toThrow('Sharing changed since approval');
});
