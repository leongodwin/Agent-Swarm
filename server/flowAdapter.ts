import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { discoverSkills } from './skillRegistry.ts';
import type { PlatformIdentity } from './platformAuth.ts';
import { verifyFlowIdentity } from './platformAuth.ts';
import type { TargetAction, TargetComponent } from './targetOperations.ts';
export interface FlowAdapter { call(tool: string, args: Record<string, unknown>): Promise<unknown>; close(): Promise<void> }
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
export async function connectFlowAdapter(cwd: string, signal: AbortSignal): Promise<FlowAdapter> {
  const skill = discoverSkills().skills.find((s) => s.id === 'power-automate:manage-flows');
  const entry = process.env.SWARM_FLOWAGENT_ENTRY ?? (skill ? path.resolve(path.dirname(skill.file), '..', '..', 'server', 'mcp.mjs') : '');
  if (!entry || !(await fs.stat(entry).catch(() => null))?.isFile()) throw new Error('FlowAgent runtime is unavailable; install/enable the Power Automate plugin or configure SWARM_FLOWAGENT_ENTRY');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd, stderr: 'ignore', env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
  const client = new Client({ name: 'swarm-flow-delivery', version: '1' });
  const abort = () => { void transport.close(); }; signal.addEventListener('abort', abort, { once: true });
  const close = async () => { signal.removeEventListener('abort', abort); await client.close(); await transport.close(); };
  try {
    signal.throwIfAborted(); await client.connect(transport, { timeout: 15000 });
    const names = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) { const list = await client.listTools({ cursor }, { signal, timeout: 15000 }); list.tools.forEach((tool) => names.add(tool.name)); cursor = list.nextCursor; if (!cursor) break; }
    if (cursor) throw new Error('FlowAgent tool discovery exceeded its pagination limit');
    for (const tool of ['whoami', 'get_flow', 'get_flow_context', 'preflight_flow', 'publish_flow', 'disable_flow', 'get_run_history', 'get_run_action_content']) if (!names.has(tool)) throw new Error(`FlowAgent tool ${tool} is missing`);
    return { close, async call(tool, args) {
      signal.throwIfAborted();
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: 30000 });
      if (result.isError) throw new Error(`FlowAgent ${tool} failed; check authentication, target access and managed-solution restrictions`);
      const content = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(result.content);
      const text = content.filter((item) => item.type === 'text').map((item) => item.text).join('');
      if (text.length > 2 * 1024 * 1024) throw new Error(`FlowAgent ${tool} response is too large`);
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && !Array.isArray(value) && (value.success === false || value.found === false || value.error)) throw new Error(`FlowAgent ${tool} returned a blocked outcome`);
      return value;
    } };
  } catch (error) { await close(); throw error; }
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
export const cloudFlowCheckSchema = z.object({ component: z.string().min(1), action: z.string().min(1), correlationPointer: z.array(z.string()).min(1), assertions: z.array(z.object({ pointer: z.array(z.string()).min(1), equals: z.union([z.string(), z.boolean(), z.number()]) }).strict()).min(1).max(20) }).strict();
const at = (data: unknown, pointer: string[]) => pointer.reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, data);
/** Correlate recorded action output with this delivery, never just the most recent successful run. */
export async function verifyCloudFlowRun(adapter: FlowAdapter, environmentId: string, flowId: string, releaseRunId: string, startedAt: string, check: z.infer<typeof cloudFlowCheckSchema>) {
  const runs = z.array(z.object({ name: z.string(), startTime: z.string(), endTime: z.string().optional(), status: z.string() })).parse(await adapter.call('get_run_history', { env: environmentId, flow: flowId, top: 20 }));
  for (const run of runs.filter((run) => run.status === 'Succeeded' && Date.parse(run.startTime) >= Date.parse(startedAt) && Date.parse(run.startTime) <= Date.now() + 60000)) {
    const result = z.object({ content: z.unknown().optional(), skipped: z.string().optional() }).parse(await adapter.call('get_run_action_content', { env: environmentId, flow: flowId, run: run.name, action: check.action, which: 'outputs', maxBytes: 256000 }));
    if (result.skipped || at(result.content, check.correlationPointer) !== releaseRunId) continue;
    for (const assertion of check.assertions) if (at(result.content, assertion.pointer) !== assertion.equals) throw new Error(`Correlated cloud flow ${check.component} failed its output assertion`);
    return { component: check.component, flowId, runId: run.name, startTime: run.startTime, status: run.status, correlationId: releaseRunId, assertions: check.assertions };
  }
  throw new Error(`No fresh successful cloud-flow run correlates with delivery ${releaseRunId}; exercise the flow with SWARM_DELIVERY_RUN_ID and record the correlation in ${check.action} outputs`);
}
