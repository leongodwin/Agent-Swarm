import crypto from 'node:crypto';
import {nativeTargetSchema} from '../shared/nativeQa.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { discoverSkills } from './skillRegistry.ts';
import type { PlatformIdentity } from './platformAuth.ts';
import { verifyFlowIdentity } from './platformAuth.ts';
import type { TargetAction, TargetComponent } from './targetOperations.ts';
import {flowCleanup} from './flowCleanup.ts';
import {flowAdapterEnvironment} from './flowEnvironment.ts';
export interface FlowAdapter { metadata?:{name:string;version:string;entrySha256:string};call(tool: string, args: Record<string, unknown>): Promise<unknown>; close(): Promise<void> }
/** The Flow API adds this parameter reference to connector inputs on readback.
 * The save validator rejects it in authored definitions. Strip only that exact
 * injected reference for connector steps, leaving explicit/custom auth intact. */
export function flowDefinitionForPreflight(definition: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(definition);
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (['OpenApiConnection', 'OpenApiConnectionWebhook', 'OpenApiConnectionNotification'].includes(String(node.type)) && node.inputs && typeof node.inputs === 'object') {
      const inputs = node.inputs as Record<string, unknown>;
      if (inputs.authentication === "@parameters('$authentication')") delete inputs.authentication;
    }
    Object.values(node).forEach(walk);
  };
  walk(copy); return copy;
}
export async function connectFlowAdapter(cwd: string, signal: AbortSignal,admission?:{beforeRequest():Promise<void>;captureNativeFailure?:(tool:string,result:unknown)=>Promise<void>;maxPages?:number;expectedEntrySha256?:string;entryPath?:string;requiredTools?:readonly ('create_standalone_flow'|'read_standalone_flow_owners')[]}): Promise<FlowAdapter> {
  const maxPages=z.number().int().min(1).max(20).parse(admission?.maxPages??20);
  const skill = discoverSkills().skills.find((s) => s.id === 'power-automate:manage-flows');
  const entry = admission?.entryPath ?? process.env.SWARM_FLOWAGENT_ENTRY ?? (skill ? path.resolve(path.dirname(skill.file), '..', '..', 'server', 'mcp.mjs') : '');
  const requiredTools=z.array(z.enum(['create_standalone_flow','read_standalone_flow_owners'])).max(2).parse(admission?.requiredTools??[]);
  if(admission?.entryPath){const stat=await fs.lstat(entry);if(!admission.expectedEntrySha256||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(entry)!==path.resolve(entry))throw Error('Explicit FlowAgent entry requires canonical reviewed source and its approved hash');}
  if (!entry || !(await fs.stat(entry).catch(() => null))?.isFile()) throw new Error('FlowAgent runtime is unavailable; install/enable the Power Automate plugin or configure SWARM_FLOWAGENT_ENTRY');
  const entrySha256=crypto.createHash('sha256').update(await fs.readFile(entry)).digest('hex');
  if(admission?.expectedEntrySha256!==undefined&&entrySha256!==z.string().regex(/^[a-f0-9]{64}$/).parse(admission.expectedEntrySha256))throw Error('FlowAgent approved entry differs before launch');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd, stderr: 'ignore', env: flowAdapterEnvironment() });
  const client = new Client({ name: 'swarm-flow-delivery', version: '1' });
  const cleanup=flowCleanup(client,transport);
  const close = () => {signal.removeEventListener('abort',abort);return cleanup.close();};
  const abort = () => { void close().catch(()=>{/* Explicit finally/close preserves cleanup failure; cancellation cannot acknowledge exit. */}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();await admission?.beforeRequest();signal.throwIfAborted();cleanup.started(); await client.connect(transport, { timeout: 15000 });
    signal.throwIfAborted();cleanup.assertOpen();
    const names = new Set<string>(),cursors=new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) { await admission?.beforeRequest();signal.throwIfAborted();cleanup.assertOpen();const list = await client.listTools({ cursor }, { signal, timeout: 15000 });signal.throwIfAborted();cleanup.assertOpen();list.tools.forEach((tool) => names.add(tool.name));cursor = list.nextCursor;if (!cursor) break;if(cursors.has(cursor))throw new Error('FlowAgent tool discovery returned a repeated cursor');cursors.add(cursor); }
    if (cursor) throw new Error('FlowAgent tool discovery exceeded its pagination limit');
    for (const tool of ['whoami', 'get_flow', 'get_flow_context', 'preflight_flow', 'publish_flow', 'disable_flow', 'get_run_history', 'get_run_details', 'get_run_actions', 'get_run_action_content']) if (!names.has(tool)) throw new Error(`FlowAgent tool ${tool} is missing`);
    for(const tool of requiredTools)if(!names.has(tool))throw Error(`FlowAgent tool ${tool} is missing`);
    const server=client.getServerVersion();if(!server||crypto.createHash('sha256').update(await fs.readFile(entry)).digest('hex')!==entrySha256)throw Error('FlowAgent runtime changed during admission');
    const metadata=z.object({name:z.string().min(1).max(200),version:z.string().min(1).max(100),entrySha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse({...server,entrySha256});
    return { metadata,close, async call(tool, args) {
      signal.throwIfAborted();cleanup.assertOpen();
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: 30000 });
      // Protected capture precedes interpretation and preserves error wrappers.
      // The callback owns ACL/bounds admission; errors never enter messages.
      const failure=async()=>{await admission?.captureNativeFailure?.(tool,result);};
      if(result.isError){await failure();throw new Error(`FlowAgent ${tool} failed; check authentication, target access and managed-solution restrictions`);}
      signal.throwIfAborted();cleanup.assertOpen();
      const content = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(result.content);
      const text = content.filter((item) => item.type === 'text').map((item) => item.text).join('');
      if (Buffer.byteLength(text,'utf8') > 2 * 1024 * 1024) throw new Error(`FlowAgent ${tool} response is too large`);
      let value:Record<string,unknown>|unknown[]|string|number|boolean|null;try{value=parseUnambiguousJson(text,{maxBytes:2*1024*1024}) as typeof value;}catch{throw new Error(`FlowAgent ${tool} returned invalid JSON; response content is withheld`);}
      if (value && typeof value === 'object' && !Array.isArray(value) && (value.success === false || value.found === false || value.error)) {await failure();throw new Error(`FlowAgent ${tool} returned a blocked outcome`);}
      return value;
    } };
  } catch (error) {try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],'FlowAgent connection failed and runtime cleanup is unverified');}throw error;}
}

export async function verifyCloudFlowContext(adapter: FlowAdapter, identity: PlatformIdentity, flowId: string, workflowId: string, solutionName: string) {
  verifyFlowIdentity(await adapter.call('whoami', {}), identity);
  const context = z.object({ workflowId: z.string(), inSolution: z.literal(true), solutionUniqueName: z.string(), isManaged: z.boolean(), category: z.literal(5), warning: z.null().optional() }).parse(await adapter.call('get_flow_context', { env: identity.environmentId, flow: flowId }));
  // Unmanaged components are often reported in the Active layer. Named membership is checked by the Dataverse target mapper.
  if (context.workflowId.toLowerCase() !== workflowId.toLowerCase() || context.solutionUniqueName.toLowerCase() !== solutionName.toLowerCase() && !(context.solutionUniqueName === 'Active' && !context.isManaged)) throw new Error('Cloud flow does not belong to the mapped target solution');
}

/** A correct reference row is insufficient if the deployed flow uses a different binding. */
export async function verifyCloudFlowBindings(adapter: FlowAdapter, environmentId: string, flowId: string, components: TargetComponent[], actions: TargetAction[]) {
  return checkFlowBindings(adapter, environmentId, flowId, components, actions);
}
/** Imported stopped flows resolve embedded connection names during activation.
 * Require a fresh check of the approved Dataverse reference before activating;
 * the caller must then verify resolved runtime bindings with the strict check. */
export async function verifyCloudFlowActivationBindings(adapter: FlowAdapter, environmentId: string, flowId: string, components: TargetComponent[], actions: TargetAction[], verifyReference: (action: Extract<TargetAction, { type: 'connection-reference-check' }>) => Promise<void>) {
  return checkFlowBindings(adapter, environmentId, flowId, components, actions, verifyReference);
}
async function checkFlowBindings(adapter: FlowAdapter, environmentId: string, flowId: string, components: TargetComponent[], actions: TargetAction[], verifyReference?: (action: Extract<TargetAction, { type: 'connection-reference-check' }>) => Promise<void>) {
  const references = z.record(z.string(), z.object({ connectionName: z.string().min(1).optional(), source: z.string().optional(), connectionReferenceLogicalName: z.string().min(1), id: z.string().min(1) })).parse(await adapter.call('get_flow', { env: environmentId, flow: flowId, path: 'properties.connectionReferences' }));
  const observations = [];
  for (const [alias, reference] of Object.entries(references)) {
    const component = components.find((component) => component.kind === 'connection-reference' && component.logicalName === reference.connectionReferenceLogicalName);
    const approved = actions.filter((action): action is Extract<TargetAction, { type: 'connection-reference-check' }> => action.type === 'connection-reference-check' && action.component === component?.key);
    if (!component || !approved.length || approved.some((action) => action.connectorId !== reference.id || action.connectionId !== approved[0].connectionId)) throw new Error(`Cloud flow connection ${alias} lacks a matching approved target binding`);
    let connectionName = reference.connectionName;
    if (!connectionName) {
      if (!verifyReference || reference.source !== 'Embedded') throw new Error(`Cloud flow connection ${alias} is unresolved`);
      await verifyReference(approved[0]);
      connectionName = approved[0].connectionId;
    }
    if (approved.some((action) => action.connectionId !== connectionName)) throw new Error(`Cloud flow connection ${alias} lacks a matching approved target binding`);
    observations.push({ alias, component: component.key, connectionId: connectionName, connectorId: reference.id });
  }
  return observations;
}
const flowPointer=z.array(z.string().min(1).max(200).refine(key=>!['__proto__','constructor','prototype'].includes(key))).min(1).max(20);
const triggerEvidenceSchema=z.strictObject({name:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),siteUrl:nativeTargetSchema.shape.siteUrl,listId:z.uuid(),itemId:z.number().int().positive(),itemIdPointer:flowPointer,version:z.string().min(1).max(100),versionPointer:flowPointer,correlationPointer:flowPointer,assertions:z.array(z.strictObject({pointer:flowPointer,equals:z.union([z.string(),z.number(),z.boolean()])})).min(1).max(20)});
export const cloudFlowCheckSchema = z.object({selectionAssertions:z.array(z.strictObject({pointer:flowPointer,equals:z.union([z.string(),z.number(),z.boolean()])})).min(1).max(10).optional(),sharepointTrigger:triggerEvidenceSchema.optional(), component: z.string().min(1).max(200), action: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), correlationPointer: flowPointer, assertions: z.array(z.object({ pointer: flowPointer, equals: z.union([z.string(), z.boolean(), z.number()]) }).strict()).min(1).max(20) }).strict();
const at = (data: unknown, pointer: string[]) => pointer.reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, data);
/** Recent history locates candidates only. Exact provider reads bind positive
 * dispatch evidence; neither an empty list nor a match proves historical absence. */
export async function verifyCloudFlowRun(adapter: FlowAdapter, environmentId: string, flowId: string, releaseRunId: string, startedAt: string, rawCheck: z.infer<typeof cloudFlowCheckSchema>) {
  const check=cloudFlowCheckSchema.parse(rawCheck),safeId=z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
  safeId.parse(environmentId);safeId.parse(flowId);safeId.parse(releaseRunId);
  const since=z.iso.datetime({offset:true}).parse(startedAt);if(Date.parse(since)>Date.now())throw new Error('Cloud-flow observation start is in the future');
  const bounded=(value:unknown)=>{try{const text=JSON.stringify(value);if(!text||Buffer.byteLength(text)>256000)throw Error();return crypto.createHash('sha256').update(text).digest('hex');}catch{throw new Error('Cloud-flow provider evidence malformed or oversized; content withheld');}};
  const runSchema=z.object({name:safeId,startTime:z.iso.datetime({offset:true}),endTime:z.iso.datetime({offset:true}).optional(),status:z.string()});
  const history=await adapter.call('get_run_history',{env:environmentId,flow:flowId,top:20});bounded(history);const runs=z.array(runSchema).max(20).parse(history);
  if(new Set(runs.map(run=>run.name)).size!==runs.length)throw new Error('Cloud-flow history contains duplicate run identities');
  const details=async(name:string)=>{
    const raw=await adapter.call('get_run_details',{env:environmentId,flow:flowId,run:name}),sha256=bounded(raw);
    const value=z.object({name:safeId,id:z.string(),properties:z.object({startTime:z.iso.datetime({offset:true}),endTime:z.iso.datetime({offset:true}),status:z.literal('Succeeded')})}).parse(raw);
    const expected=`/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs/${name}`;
    if(value.name!==name||value.id.toLowerCase()!==expected.toLowerCase()||!value.id.endsWith('/runs/'+name)||Date.parse(value.properties.startTime)<Date.parse(since)||Date.parse(value.properties.endTime)<Date.parse(value.properties.startTime)||Date.parse(value.properties.endTime)>Date.now())throw new Error('Cloud-flow provider run identity or chronology differs');
    return{value,sha256,trigger:z.object({properties:z.object({trigger:z.unknown().optional()})}).parse(raw).properties.trigger};
  };
  for(const candidate of runs.filter(run=>run.status==='Succeeded'&&Date.parse(run.startTime)>=Date.parse(since)&&Date.parse(run.startTime)<=Date.now())){
    const first=await details(candidate.name);
    const source=check.sharepointTrigger;let triggerDefinitionSha256:string|undefined,triggerOutputSha256:string|undefined,triggerStartTime:string|undefined,triggerEndTime:string|undefined;
    const definition=async()=>{const raw=await adapter.call('get_flow',{env:environmentId,flow:flowId,path:'properties.definition'});bounded(raw);const triggers=z.object({triggers:z.record(z.string(),z.unknown())}).parse(raw).triggers;if(!source||!Object.hasOwn(triggers,source.name))throw new Error('Approved SharePoint trigger unavailable');const trigger=z.object({type:z.enum(['OpenApiConnection','OpenApiConnectionWebhook','OpenApiConnectionNotification']),inputs:z.object({host:z.object({apiId:z.literal('/providers/Microsoft.PowerApps/apis/shared_sharepointonline'),operationId:z.enum(['GetOnNewItems','GetOnUpdatedItems','GetOnNewFileItems','GetOnUpdatedFileItems'])}),parameters:z.object({dataset:z.string(),table:z.string()})})}).parse(triggers[source.name]);if(trigger.inputs.parameters.dataset!==source.siteUrl||trigger.inputs.parameters.table.toLowerCase()!==source.listId.toLowerCase())throw new Error('SharePoint trigger target differs');return bounded(trigger);};
    if(first.value.properties.startTime!==candidate.startTime||candidate.endTime&&candidate.endTime!==first.value.properties.endTime)throw new Error('Cloud-flow history and exact run differ');
    const raw=await adapter.call('get_run_action_content',{env:environmentId,flow:flowId,run:candidate.name,action:check.action,which:'outputs',maxBytes:256000}),actionOutputSha256=bounded(raw);
    const result=z.object({action:z.literal(check.action),which:z.literal('outputs'),content:z.unknown().optional(),skipped:z.string().optional()}).parse(raw);
    if(result.skipped!==undefined||!Object.hasOwn(result,'content'))continue;
    if(at(result.content,check.correlationPointer)!==releaseRunId)continue;
    if(check.selectionAssertions?.some(a=>at(result.content,a.pointer)!==a.equals))continue;
    for(const assertion of check.assertions)if(at(result.content,assertion.pointer)!==assertion.equals)throw new Error(`Correlated cloud flow ${check.component} failed its output assertion`);
    if(source){triggerDefinitionSha256=await definition();const trigger=z.object({name:z.literal(source.name),status:z.literal('Succeeded'),startTime:z.iso.datetime({offset:true}),endTime:z.iso.datetime({offset:true}),outputs:z.unknown()}).parse(first.trigger);if(!Object.hasOwn(trigger,'outputs')||trigger.outputs===undefined||Date.parse(trigger.startTime)<Date.parse(since)||Date.parse(trigger.endTime)<Date.parse(trigger.startTime)||Date.parse(trigger.endTime)>Date.parse(first.value.properties.startTime))throw new Error('SharePoint trigger chronology or recorded outputs unavailable');if(at(trigger.outputs,source.correlationPointer)!==releaseRunId||at(trigger.outputs,source.itemIdPointer)!==source.itemId||at(trigger.outputs,source.versionPointer)!==source.version||source.assertions.some(assertion=>at(trigger.outputs,assertion.pointer)!==assertion.equals))throw new Error('SharePoint trigger output correlation differs');triggerOutputSha256=bounded(trigger.outputs);triggerStartTime=trigger.startTime;triggerEndTime=trigger.endTime;}
    const last=await details(candidate.name);
    if(source&&(JSON.stringify(last.trigger)!==JSON.stringify(first.trigger)||await definition()!==triggerDefinitionSha256))throw new Error('SharePoint trigger evidence changed during observation');
    if(JSON.stringify(last.value)!==JSON.stringify(first.value))throw new Error('Cloud-flow provider run changed during observation');
    return{component:check.component,flowId,runId:candidate.name,startTime:first.value.properties.startTime,endTime:first.value.properties.endTime,status:'Succeeded',correlationId:releaseRunId,assertions:check.assertions,providerRunSha256:last.sha256,actionOutputSha256,positiveDispatchObserved:true,sharepointTriggerCorrelationObserved:Boolean(source),...(source?{triggerDefinitionSha256,triggerOutputSha256,sharepointTriggerEvidence:{binding:source,startTime:triggerStartTime,endTime:triggerEndTime},historicalTriggerDefinitionVerified:false}:{}),sharepointCausalityVerified:false,completeDispatches:false,replayAuthorized:false};
  }
  throw new Error(`No fresh successful cloud-flow run correlates with delivery ${releaseRunId}; exercise the flow with SWARM_DELIVERY_RUN_ID and record the correlation in ${check.action} outputs`);
}
