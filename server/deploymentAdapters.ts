import { z } from 'zod';
import type { DeliveryRun } from '../shared/delivery.ts';
import type { TargetAction, MappedComponent, Request } from './targetOperations.ts';
import { reconcile } from './platformLifecycle.ts';

export type AdditionalAction = Extract<TargetAction, { type: 'connection-reference-bind' | 'record-share' | 'schema-check' }>;
const sameRights = (a: string[], b: string[]) => [...new Set(a)].sort().join(',') === [...new Set(b)].sort().join(',');
const attribute = z.object({ LogicalName: z.string(), AttributeType: z.string(), AttributeTypeName: z.object({ Value: z.string() }).optional(), RequiredLevel: z.object({ Value: z.string() }) });
const attributeType = (value: z.infer<typeof attribute>) => value.AttributeTypeName?.Value === 'FileType' ? 'File' : value.AttributeType;

export async function reconcileAdditionalAction(action: AdditionalAction, component: MappedComponent, request: Request, run: DeliveryRun, save: () => Promise<void>, owned: () => Promise<void>) {
  let mutate: () => Promise<unknown> = async () => { throw new Error('Schema contract not observed; repair through a reviewed solution import'); };
  let observe: () => Promise<boolean>;
  if (action.type === 'connection-reference-bind') {
    if (component.kind !== 'connection-reference') throw new Error('Binding repair requires a connection reference');
    let etag = '';
    observe = async () => {
      const row = z.object({ connectionid: z.string().nullable(), connectorid: z.string(), statecode: z.literal(0), '@odata.etag': z.string().regex(/^W\/"\d+"$/) }).parse(await request('GET', `connectionreferences(${component.id})?$select=connectionid,connectorid,statecode`));
      if (row.connectorid !== action.connectorId) throw new Error('Connector differs from approved binding');
      if (row.connectionid === action.connectionId) return true;
      if (row.connectionid !== action.expectedConnectionId) throw new Error('Connection changed since repair approval');
      etag = row['@odata.etag']; return false;
    };
    mutate = () => request('PATCH', `connectionreferences(${component.id})`, { connectionid: action.connectionId }, { 'If-Match': etag });
  } else if (action.type === 'schema-check') {
    if (component.kind !== 'dataverse-table' || !component.logicalName) throw new Error('Schema contract requires a mapped table');
    observe = async () => {
      const metadata = z.object({ value: z.array(attribute) }).parse(await request('GET', `EntityDefinitions(LogicalName='${component.logicalName}')/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,RequiredLevel`));
      if (metadata.value.length >= 5000) throw new Error('Schema inventory may be truncated');
      return action.columns.every((column) => metadata.value.some((actual) => actual.LogicalName === column.name && attributeType(actual) === column.type && actual.RequiredLevel.Value === column.required));
    };
  } else {
    if (component.kind !== 'dataverse-table' || !component.logicalName || !component.entitySet || !component.primaryId) throw new Error('Record sharing requires a mapped table');
    const target = { '@odata.type': `Microsoft.Dynamics.CRM.${component.logicalName}`, '@odata.id': `${component.entitySet}(${action.recordId})` };
    observe = async () => {
      const principal = z.object(action.principalType === 'systemuser' ? { isdisabled: z.literal(false) } : { teamid: z.literal(action.principalId) }).parse(await request('GET', `${action.principalType === 'systemuser' ? 'systemusers' : 'teams'}(${action.principalId})?$select=${action.principalType === 'systemuser' ? 'isdisabled' : 'teamid'}`));
      void principal;
      await request('GET', `${component.entitySet}(${action.recordId})`);
      const result = z.object({ PrincipalAccesses: z.array(z.object({ Principal: z.record(z.string(), z.unknown()), AccessMask: z.string() })) }).parse(await request('GET', `RetrieveSharedPrincipalsAndAccess(Target=@target)?@target=${encodeURIComponent(JSON.stringify(target))}`));
      const shared = result.PrincipalAccesses.filter((access) => String(access.Principal[`${action.principalType}id`]).toLowerCase() === action.principalId.toLowerCase());
      if (shared.length > 1) throw new Error('Ambiguous principal access');
      const rights = shared[0]?.AccessMask.split(',').map((right) => right.trim()).filter((right) => right !== 'None') ?? [];
      if (sameRights(rights, action.rights)) return true;
      if (!sameRights(rights, action.expectedRights)) throw new Error('Sharing changed since approval');
      return false;
    };
    if (action.expectedRights.length) throw new Error('Existing shares require a separately reviewed modification');
    mutate = () => request('POST', 'GrantAccess', { Target: { '@odata.type': `Microsoft.Dynamics.CRM.${component.logicalName}`, [component.primaryId!]: action.recordId }, PrincipalAccess: { Principal: { '@odata.type': `Microsoft.Dynamics.CRM.${action.principalType}`, [`${action.principalType}id`]: action.principalId }, AccessMask: [...new Set(action.rights)].join(',') } });
  }
  await reconcile(`typed:${action.id}`, { action, component, environmentUrl: run.environmentUrl }, run, save, owned, observe, mutate);
}

/** Detect incompatible declared columns before import; actual changes use the supported solution pipeline. */
export async function verifyMigrationCompatibility(actions: TargetAction[], components: { key: string; logicalName: string }[], request: Request) {
  for (const action of actions) {
    if (action.type !== 'schema-check') continue;
    const table = components.find((component) => component.key === action.component)!;
    const tables = z.object({ value: z.array(z.object({ Attributes: z.array(attribute), 'Attributes@odata.nextLink': z.never().optional() })).max(1) }).parse(await request('GET', `EntityDefinitions?$select=LogicalName&$filter=${encodeURIComponent(`LogicalName eq '${table.logicalName}'`)}&$expand=Attributes($select=LogicalName,AttributeType,AttributeTypeName,RequiredLevel)&$top=2`));
    // A missing table is an additive import, not an unknown HTTP error.
    if (!tables.value.length) continue;
    const result = tables.value[0].Attributes;
    if (result.length >= 5000) throw new Error('Schema inventory may be truncated');
    for (const column of action.columns) {
      const old = result.find((item) => item.LogicalName === column.name);
      if (old && (attributeType(old) !== column.type || old.RequiredLevel.Value !== column.required)) throw new Error(`Incompatible schema migration for ${table.logicalName}.${column.name}; provide a separately reviewed data migration`);
    }
  }
}
