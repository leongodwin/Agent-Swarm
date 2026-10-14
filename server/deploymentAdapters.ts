import { z } from 'zod';
import type { DeliveryRun } from '../shared/delivery.ts';
import type { TargetAction, MappedComponent, Request } from './targetOperations.ts';
import { reconcile } from './platformLifecycle.ts';
import {baseAttribute as attribute,verifyColumns} from './columnContracts.ts';
import {verifyTableStructure} from './tableStructure.ts';

export type AdditionalAction = Extract<TargetAction, { type: 'connection-reference-bind' | 'record-share' | 'schema-check' }>;
const sameRights = (a: string[], b: string[]) => [...new Set(a)].sort().join(',') === [...new Set(b)].sort().join(',');
const guid=z.string().uuid();
const sameId=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const accessRights=new Set(['ReadAccess','WriteAccess','AppendAccess','AppendToAccess','CreateAccess','DeleteAccess','ShareAccess','AssignAccess']);
function observedPrincipal(principal:Record<string,unknown>){
  const declared=principal['@odata.type'];
  const type=declared===undefined?undefined:z.string().parse(declared).replace(/^#/,'').replace(/^Microsoft\.Dynamics\.CRM\./,'');
  if(type!==undefined&&type!=='systemuser'&&type!=='team')throw new Error('Unrecognized shared principal type');
  const keys=['systemuser','team'].filter(key=>principal[`${key}id`]!==undefined);
  if(keys.length>1||keys.length===1&&type!==undefined&&keys[0]!==type)throw new Error('Conflicting shared principal identities');
  const kind=type??keys[0];if(!kind)throw new Error('Shared principal identity is missing');
  const direct=principal[`${kind}id`],owner=principal.ownerid;
  if(owner!==undefined&&type===undefined)throw new Error('Polymorphic principal requires its declared type');
  const id=guid.parse(direct??owner);
  if(owner!==undefined&&!sameId(id,guid.parse(owner)))throw new Error('Conflicting shared principal identities');
  return {kind,id};
}
function observedRights(mask:string){
  if(mask==='None')return [];
  const rights=mask.split(',').map(right=>right.trim());
  if(!rights.length||rights.some(right=>!accessRights.has(right))||new Set(rights).size!==rights.length)throw new Error('Shared access mask is malformed or unsupported');
  return rights;
}

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
      const metadata = z.object({ value: z.array(attribute),'@odata.nextLink':z.never().optional() }).parse(await request('GET', `EntityDefinitions(LogicalName='${component.logicalName}')/Attributes?$select=LogicalName,MetadataId,AttributeType,AttributeTypeName,RequiredLevel`));
      if (metadata.value.length >= 5000) throw new Error('Schema inventory may be truncated');
      try {await verifyColumns(action.columns,component.logicalName!,metadata.value,request);if(action.structure)await verifyTableStructure(action.structure,component.logicalName!,request);return true;}
      catch {throw new Error('Schema contract verification failed; inspect metadata and use a reviewed solution import for changes');}
    };
  } else {
    if (component.kind !== 'dataverse-table' || !component.logicalName || !component.entitySet || !component.primaryId) throw new Error('Record sharing requires a mapped table');
    // Function entity-reference literals accept @odata.id, not an action-style
    // polymorphic object. The slash makes the identifier service-root relative.
    const target = { '@odata.id': `/${component.entitySet}(${action.recordId})` };
    observe = async () => {
      const principalResponse=await request('GET', `${action.principalType === 'systemuser' ? 'systemusers' : 'teams'}(${action.principalId})?$select=${action.principalType === 'systemuser' ? 'systemuserid,isdisabled' : 'teamid'}`);
      const observedId=action.principalType==='systemuser'?z.object({systemuserid:guid,isdisabled:z.literal(false)}).parse(principalResponse).systemuserid:z.object({teamid:guid}).parse(principalResponse).teamid;
      if(!sameId(observedId,action.principalId))throw new Error('Principal differs from the approved sharing identity');
      const record=z.object({[component.primaryId!]:guid}).parse(await request('GET', `${component.entitySet}(${action.recordId})?$select=${component.primaryId}`));
      if(!sameId(record[component.primaryId!] as string,action.recordId))throw new Error('Record differs from the approved sharing identity');
      const result = z.object({ PrincipalAccesses: z.array(z.object({ Principal: z.record(z.string(), z.unknown()), AccessMask: z.string() })).max(5000),'@odata.nextLink':z.never().optional(),'PrincipalAccesses@odata.nextLink':z.never().optional() }).parse(await request('GET', `RetrieveSharedPrincipalsAndAccess(Target=@target)?@target=${encodeURIComponent(JSON.stringify(target))}`));
      if(result.PrincipalAccesses.length===5000)throw new Error('Sharing inventory may be truncated');
      const shared=result.PrincipalAccesses.map(access=>({...observedPrincipal(access.Principal),rights:observedRights(access.AccessMask)})).filter(access=>access.kind===action.principalType&&sameId(access.id,action.principalId));
      if (shared.length > 1) throw new Error('Ambiguous principal access');
      const rights = shared[0]?.rights ?? [];
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
    const matches=components.filter(component=>component.key===action.component);
    if(matches.length!==1)throw new Error('Schema check must resolve to exactly one approved table');
    const table=matches[0];
    const tableName=z.string().regex(/^[a-z_][a-z0-9_]*$/i).parse(table.logicalName).toLowerCase();
    const tables = z.object({ value: z.array(z.object({ LogicalName:z.string().regex(/^[a-z_][a-z0-9_]*$/), Attributes: z.array(attribute), 'Attributes@odata.nextLink': z.never().optional() })).max(1),'@odata.nextLink':z.never().optional() }).parse(await request('GET', `EntityDefinitions?$select=LogicalName&$filter=${encodeURIComponent(`LogicalName eq '${tableName}'`)}&$expand=Attributes($select=LogicalName,MetadataId,AttributeType,AttributeTypeName,RequiredLevel)`));
    // A missing table is an additive import, not an unknown HTTP error.
    if (!tables.value.length) continue;
    if(tables.value[0].LogicalName!==tableName)throw new Error('Schema response differs from the approved table identity');
    const result = tables.value[0].Attributes;
    if (result.length >= 5000) throw new Error('Schema inventory may be truncated');
    try {await verifyColumns(action.columns,tableName,result,request,true);if(action.structure)await verifyTableStructure(action.structure,tableName,request,true);}catch {throw new Error(`Incompatible schema migration for ${tableName}; provide a separately reviewed data migration`);}
  }
}
