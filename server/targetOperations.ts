import crypto from 'node:crypto';
import { z } from 'zod';
import type { DeliveryRun } from '../shared/delivery.ts';
import {columnContract} from './columnContracts.ts';
import {tableStructureContract} from './tableStructure.ts';
import {reconcile} from './operationReconciliation.ts';

// Dataverse IDs are GUIDs; legacy sequential IDs need not have RFC UUID version bits.
export const dataverseGuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const guid = dataverseGuid;
export const targetBindingSchema = z.object({ organizationId: guid, userId: guid }).strict();
export const targetComponentSchema = z.object({ key: z.string().regex(/^[\w-]+$/), kind: z.enum(['canvas', 'workflow', 'cloud-flow', 'copilot', 'connection-reference', 'dataverse-table']), logicalName: z.string().regex(/^[A-Za-z_][\w]*$|^[a-f0-9-]{36}$/i).max(200) }).strict();
export const targetActionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('workflow-state'), component: z.string(), state: z.enum(['active', 'draft']) }).strict(),
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('cloud-flow-state'), component: z.string(), state: z.enum(['active', 'draft']), forceManaged: z.boolean().default(false) }).strict(),
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('copilot-publish'), component: z.string() }).strict(),
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('connection-reference-check'), component: z.string(), connectionId: z.string().trim().min(1).max(1000), connectorId: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('connection-reference-bind'), component: z.string(), expectedConnectionId: z.string().nullable(), connectionId: z.string().min(1).max(1000), connectorId: z.string().min(1).max(1000) }).strict(),
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('record-share'), component: z.string(), recordId: guid, principalId: guid, principalType: z.enum(['systemuser', 'team']), expectedRights: z.array(z.enum(['ReadAccess', 'WriteAccess', 'AppendAccess', 'AppendToAccess'])).length(0), rights: z.array(z.enum(['ReadAccess', 'WriteAccess', 'AppendAccess', 'AppendToAccess'])).min(1).max(4) }).strict(),
  z.object({ id: z.string().regex(/^[\w-]+$/), type: z.literal('schema-check'), component: z.string(), columns: z.array(columnContract).min(1).max(100).refine(columns=>new Set(columns.map(column=>column.name)).size===columns.length,'Column contracts must be unique'),structure:tableStructureContract.optional() }).strict(),
]);
export type TargetComponent = z.infer<typeof targetComponentSchema>;
export type TargetAction = z.infer<typeof targetActionSchema>;
export interface MappedComponent { key: string; kind: TargetComponent['kind']; id: string; playId?: string; logicalName?: string; entitySet?: string; primaryId?: string }
export function verifyMappedCanvasUrls(mapping: MappedComponent[], urls: string[]) {
  for (const component of mapping.filter((item) => item.kind === 'canvas')) {
    const matched = urls.some((value) => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'apps.powerapps.com') return false;
      const match = url.pathname.match(/\/(?:a|play)\/([a-f0-9-]{36})(?:\/|$)/i)?.[1] ?? url.searchParams.get('appId');
      return match?.toLowerCase() === component.playId?.toLowerCase();
    });
    if (!matched) throw new Error(`Verification URLs do not include target Canvas app ${component.key}`);
  }
}
export type Request = (method: 'GET' | 'PATCH' | 'POST', resource: string, body?: object, headers?: Record<string, string>) => Promise<unknown>;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const rows = (result: unknown): Record<string, unknown>[] => {
  const parsed = z.object({ value: z.array(z.record(z.string(), z.unknown())) }).parse(result);
  return parsed.value;
};
const unique = (result: unknown, label: string) => {
  z.object({'@odata.nextLink':z.never().optional(),nextLink:z.never().optional()}).parse(result);
  const found = rows(result);
  if (found.length !== 1) throw new Error(`${label} must resolve to exactly one target component; found ${found.length}`);
  return found[0];
};
export async function verifyTarget(request: Request, binding: z.infer<typeof targetBindingSchema>) {
  const who = z.object({ OrganizationId: guid, UserId: guid }).parse(await request('GET', 'WhoAmI'));
  if (who.OrganizationId.toLowerCase() !== binding.organizationId.toLowerCase() || who.UserId.toLowerCase() !== binding.userId.toLowerCase()) throw new Error('Dataverse organization/user does not match the approved target binding');
}
/** Complete bounded membership inventory; continuation cannot change tenant,
 * collection, selected fields or the exact solution filter. */
async function solutionMembership(request:Request,resource:string,environmentUrl?:string){
  const output:{objectid:string;componenttype:number}[]=[],seen=new Set<string>(),links=new Set<string>();let next=resource,bytes=0;
  if(environmentUrl){const target=new URL(environmentUrl);if(target.protocol!=='https:'||target.username||target.password||target.port||target.pathname!=='/'||target.search||target.hash)throw new Error('Solution membership requires an approved HTTPS environment root');}
  const base=environmentUrl?new URL(`/api/data/v9.2/${resource}`,environmentUrl):undefined;
  for(let page=0;page<100;page++){
    const raw=await request('GET',next);bytes+=Buffer.byteLength(JSON.stringify(raw)??'');
    if(bytes>32*1024*1024)throw new Error('Solution membership inventory exceeded its byte bound');
    const value=z.object({value:z.array(z.object({objectid:guid,componenttype:z.number().int().nonnegative()})).max(5000),'@odata.nextLink':z.string().min(1).max(16000).optional(),nextLink:z.never().optional()}).parse(raw);
    for(const row of value.value){const key=`${row.objectid.toLowerCase()}:${row.componenttype}`;if(seen.has(key))throw new Error('Solution membership inventory contains duplicate identities');seen.add(key);output.push(row);}
    if(output.length>50000)throw new Error('Solution membership inventory exceeded its row bound');
    if(!value['@odata.nextLink'])return output;
    if(!base)throw new Error('Paginated solution membership requires the approved environment');
    const link=new URL(value['@odata.nextLink']);
    if(link.origin!==base.origin||link.username||link.password||link.hash||link.pathname!==base.pathname)throw new Error('Solution membership continuation differs from the approved target');
    const parameters=[...link.searchParams];
    if(new Set(parameters.map(([key])=>key)).size!==parameters.length||parameters.length!==[...base.searchParams].length+1||!link.searchParams.get('$skiptoken')||[...base.searchParams].some(([key,value])=>link.searchParams.get(key)!==value)||parameters.some(([key])=>key!=='$skiptoken'&&!base.searchParams.has(key)))throw new Error('Solution membership continuation changed the approved query');
    if(links.has(link.href))throw new Error('Solution membership continuation repeated');links.add(link.href);
    next=link.pathname.slice('/api/data/v9.2/'.length)+link.search;
  }
  throw new Error('Solution membership inventory exceeded its page bound');
}
export async function mapTargetComponents(request: Request, solutionName: string, components: TargetComponent[],environmentUrl?:string): Promise<MappedComponent[]> {
  const solution = unique(await request('GET', `solutions?$select=solutionid&$filter=${encodeURIComponent(`uniquename eq ${quote(solutionName)}`)}&$top=2`), 'Solution');
  const solutionId = guid.parse(solution.solutionid);
  const membership = await solutionMembership(request,`solutioncomponents?$select=objectid,componenttype&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,environmentUrl);
  const mapped: MappedComponent[] = [];
  for (const component of components) {
    if (component.kind === 'dataverse-table') {
      const row = z.object({ MetadataId: guid, EntitySetName: z.string().regex(/^[a-z_][a-z0-9_]*$/), PrimaryIdAttribute: z.string().regex(/^[a-z_][a-z0-9_]*$/) }).parse(await request('GET', `EntityDefinitions(LogicalName=${quote(component.logicalName)})?$select=MetadataId,EntitySetName,PrimaryIdAttribute`));
      if (!membership.some((member) => String(member.objectid).toLowerCase() === row.MetadataId.toLowerCase() && member.componenttype === 1)) throw new Error(`${component.key} is outside the target solution`);
      mapped.push({ key: component.key, kind: component.kind, id: row.MetadataId, logicalName: component.logicalName, entitySet: row.EntitySetName, primaryId: row.PrimaryIdAttribute });
      continue;
    }
    const canvas = component.kind === 'canvas';
    const copilot = component.kind === 'copilot';
    const connection = component.kind === 'connection-reference';
    // Imported cloud flows can have no uniquename. Their packaged workflow GUID is
    // stable across imports; still require membership in the exact named solution.
    const cloudGuid = component.kind === 'cloud-flow' && guid.safeParse(component.logicalName).success;
    const lookup = cloudGuid ? `workflowid eq ${component.logicalName}` : `${canvas ? 'name' : copilot ? 'schemaname' : connection ? 'connectionreferencelogicalname' : 'uniquename'} eq ${quote(component.logicalName)}`;
    const row = unique(await request('GET', `${canvas ? 'canvasapps' : copilot ? 'bots' : connection ? 'connectionreferences' : 'workflows'}?$select=${canvas ? 'canvasappid,uniquecanvasappid' : copilot ? 'botid' : connection ? 'connectionreferenceid' : 'workflowid'}&$filter=${encodeURIComponent(`${lookup}${canvas || copilot || connection ? '' : ` and type eq 1${component.kind === 'cloud-flow' ? ' and category eq 5' : ''}`}`)}&$top=2`), component.key);
    const id = guid.parse(row[canvas ? 'canvasappid' : copilot ? 'botid' : connection ? 'connectionreferenceid' : 'workflowid']);
    // Bot component codes can vary by platform metadata; require its exact object ID in the solution.
    if (!membership.some((member) => String(member.objectid).toLowerCase() === id.toLowerCase() && (copilot || connection || member.componenttype === (canvas ? 300 : 29)))) throw new Error(`${component.key} is outside the target solution`);
    mapped.push({ key: component.key, kind: component.kind, id, ...(canvas ? { playId: guid.parse(row.uniquecanvasappid) } : {}) });
  }
  return mapped;
}

/** Binding checks never grant permissions or replace a connection. Runtime flow checks remain mandatory. */
export async function verifyConnectionReference(action: Extract<TargetAction, { type: 'connection-reference-check' }>, component: MappedComponent, request: Request, run: DeliveryRun, save: () => Promise<void>, assertOwned: () => Promise<void>) {
  if (component.kind !== 'connection-reference') throw new Error(`${action.id} requires a connection-reference component`);
  const id = `typed:${action.id}`;
  const commandSha256 = crypto.createHash('sha256').update(JSON.stringify({ action, component })).digest('hex');
  run.operations ??= [];
  const matches = run.operations.filter(item => item.id === id);
  if (matches.length > 1) throw new Error(`${id} has ambiguous operation history; inspect the release before retrying`);
  let op = matches[0];
  if (op && op.commandSha256 !== commandSha256) throw new Error(`${id} target mapping or binding changed; create a new release`);
  await assertOwned();
  if (op) {
    op.status = 'unknown'; op.endedAt = new Date().toISOString(); await save();
    await assertOwned();
  }
  const row = z.object({ connectionid: z.string().nullable(), connectorid: z.string().nullable(), statecode: z.number() }).parse(await request('GET', `connectionreferences(${component.id})?$select=connectionid,connectorid,statecode`));
  await assertOwned();
  if (row.connectionid !== action.connectionId || row.connectorid !== action.connectorId || row.statecode !== 0) {
    throw new Error(`${id} connection binding is missing, inactive or differs from the approved binding; reconcile it in the target before retrying`);
  }
  if (!op) { op = { id, kind: 'post-deploy', status: 'verified', commandSha256, startedAt: new Date().toISOString() }; run.operations.push(op); }
  op.status = 'verified'; op.endedAt = new Date().toISOString(); await save();
}

/** Observe before writing and after writing; an unknown outcome is never blindly retried. */
export async function reconcileWorkflowAction(action: Extract<TargetAction, { type: 'workflow-state' }>, component: MappedComponent, request: Request, run: DeliveryRun, save: () => Promise<void>, assertOwned: () => Promise<void>) {
  if (component.kind !== 'workflow') throw new Error(`${action.id} requires a workflow component`);
  const desired = action.state === 'active' ? { statecode: 1, statuscode: 2 } : { statecode: 0, statuscode: 1 };
  const observe = async () => {
    const row = z.object({ category: z.number(), type: z.number(), statecode: z.number(), statuscode: z.number() }).parse(await request('GET', `workflows(${component.id})?$select=category,type,statecode,statuscode`));
    if (row.category !== 0 || row.type !== 1) throw new Error('Only classic workflow definitions support this adapter; cloud flows require the Power Automate adapter');
    return row.statecode === desired.statecode && row.statuscode === desired.statuscode;
  };
  await reconcile(`typed:${action.id}`, { action, component, desired }, run, save, assertOwned, observe,
    () => request('PATCH', `workflows(${component.id})`, desired));
}
