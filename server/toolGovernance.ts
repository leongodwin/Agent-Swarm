import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { atomicWrite, SerialWriter } from './atomicFile.ts';
import { auditDlpCompliance, dlpResource, ENTERPRISE_DLP_RULES } from '../shared/dlp.ts';
import type { ToolGovernanceView } from '../shared/toolGovernance.ts';
export { hookDecision, hookFailure } from '../shared/hookDecision.ts';

export interface ToolCheckpoint { actor: string; runtime: string; source: 'sdk-hook' | 'sdk-permission' | 'cli-hook'; }
export interface ToolDecision { status: 'allowed' | 'blocked' | 'unavailable'; reason: string; }
export type SessionAuthorization = () => string | null;

export function sessionAuthority(authorize?: SessionAuthorization): ToolDecision | null {
  if (!authorize) return {status: 'unavailable', reason: 'Session authorization is unavailable; execution denied'};
  try {
    const reason = authorize();
    return reason === null ? null : {status: 'blocked', reason: typeof reason === 'string' && reason ? reason : 'Session authorization is invalid; execution denied'};
  } catch { return {status: 'unavailable', reason: 'Session authorization failed; execution denied'}; }
}

/** Recheck cancellation after asynchronous policy/audit work, immediately before
 * returning an execution grant. This cannot revoke a request already dispatched. */
export async function governSessionTool(name: string, input: unknown, checkpoint: ToolCheckpoint, authorize?: SessionAuthorization): Promise<ToolDecision> {
  const denied = sessionAuthority(authorize);
  if (denied) return denied;
  const decision = await governTool(name, input, checkpoint);
  return decision.status === 'allowed' ? sessionAuthority(authorize) ?? decision : decision;
}
type Gate = (name: string, input: unknown, checkpoint: ToolCheckpoint) => Promise<ToolDecision>;
let gate: Gate = async () => ({ status: 'unavailable', reason: 'Tool governance is not initialized; retry after office readiness' });
export const setToolGovernanceGate = (value: Gate) => { gate = value; };
export async function governTool(name: string, input: unknown, checkpoint: ToolCheckpoint): Promise<ToolDecision> {
  try { return await gate(name, input, checkpoint); }
  catch { return { status: 'unavailable', reason: 'Tool governance could not be verified; execution denied' }; }
}
const ruleVersion = crypto.createHash('sha256').update(JSON.stringify(ENTERPRISE_DLP_RULES.map((rule) => [rule.id, rule.pattern.source, rule.category]))).digest('hex');
const readOnly = (name: string) => ['Read', 'Glob', 'Grep'].includes(name);
/** Request-local safeguards, not tenant policy evaluation or a sandbox for
 * indirect scripts. Native diagnostic reads remain available for remediation. */
export function evaluateToolRequest(name: string, input: unknown, copilotPaused: boolean): ToolDecision {
  if (!/^[\w.:-]{1,200}$/.test(name) || !input || typeof input !== 'object' || Array.isArray(input)) return { status: 'unavailable', reason: 'Invalid tool request; execution denied' };
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { return { status: 'unavailable', reason: 'Tool input could not be inspected' }; }
  if (Buffer.byteLength(serialized) > 1024 * 1024) return { status: 'unavailable', reason: 'Tool input exceeds the governance inspection limit' };
  if (readOnly(name)) return { status: 'allowed', reason: 'Read-only request; no tenant compliance certification' };
  const fields = input as Record<string, unknown>;
  const file = fields.file_path ?? fields.path;
  const command = fields.command ?? fields.cmd ?? fields.script;
  const strings: string[] = [];
  const collect = (value: unknown) => { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(collect); };
  collect(input);
  const text = strings.join('\n');
  const targets = [typeof file === 'string' ? file : '', typeof command === 'string' ? command : '', /^apply_patch$/i.test(name) ? text.split('\n').filter((line) => /^\*\*\* (Add|Update|Delete) File: /.test(line)).join('\n') : ''].join('\n');
  const table = fields.tableName ?? fields.table ?? fields.entityName ?? fields.entitySetName;
  const studioMcpRequest = name.startsWith('mcp__') && (/shared_mcscopilot|copilotstudio\.microsoft\.com/i.test(text) || typeof table === 'string' && /^(bot|bots|botcomponent|botcomponents)$/i.test(table));
  if (copilotPaused && (studioMcpRequest || /copilot[_-]?studio|mcscopilot|mcp__pva__/i.test(name) || /\bpac\s+copilot\s|copilotstudio\.microsoft\.com|\/bots\([a-f0-9-]+\)/i.test(targets) || /(?:^|[\s\\/])CopilotStudio[\\/]/i.test(targets))) return { status: 'blocked', reason: 'Copilot Studio delivery is paused by the manager' };
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && typeof file === 'string' && !dlpResource(file)) return { status: 'allowed', reason: 'File outside local artifact scan scope; no tenant compliance certification' };
  let proposed = strings;
  if (name === 'Write' || name === 'Edit') {
    const content = name === 'Write' ? fields.content : fields.new_string;
    if (typeof content !== 'string') return { status: 'unavailable', reason: 'Proposed file content is unavailable for inspection' };
    proposed = [content];
  } else if (name === 'MultiEdit') {
    if (!Array.isArray(fields.edits) || fields.edits.some((edit) => !edit || typeof edit.new_string !== 'string')) return { status: 'unavailable', reason: 'Proposed edits are unavailable for inspection' };
    proposed = fields.edits.map((edit) => edit.new_string);
  } else if (name === 'apply_patch') {
    const patch = fields.command ?? fields.patch ?? fields.input;
    if (typeof patch !== 'string') return { status: 'unavailable', reason: 'Proposed patch is unavailable for inspection' };
    proposed = [patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n')];
  }
  const violations = [...(['Write', 'Edit', 'MultiEdit', 'apply_patch'].includes(name) ? [] : auditDlpCompliance(serialized, 'tool-request')), ...proposed.flatMap((value) => auditDlpCompliance(value, 'tool-request'))];
  if (violations.length) return { status: 'blocked', reason: `Local connector safeguard: ${[...new Set(violations.map((v) => v.connectorName))].join(', ')}` };
  return { status: 'allowed', reason: 'Request-local safeguards passed; tenant policy and schema remain separate checks' };
}
const entrySchema = z.object({ id: z.uuid(), at: z.iso.datetime(), actor: z.string(), runtime: z.string(), source: z.enum(['sdk-hook', 'sdk-permission', 'cli-hook']), tool: z.string(), inputSha256: z.string().regex(/^[a-f0-9]{64}$/), ruleVersion: z.string(), copilotPaused: z.boolean(), status: z.enum(['allowed', 'blocked', 'unavailable']), reason: z.string() }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), evaluated: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), unavailable: z.number().int().nonnegative(), recent: z.array(entrySchema).max(100) }).strict().refine((state) => state.blocked + state.unavailable <= state.evaluated && state.recent.length <= state.evaluated);
export class ToolGovernanceService {
  private file: string;
  private state: z.infer<typeof stateSchema> = { schemaVersion: 1, evaluated: 0, blocked: 0, unavailable: 0, recent: [] };
  private unavailable: string | null = 'Tool governance is not initialized';
  private writer = new SerialWriter();
  constructor(home: string, private paused: () => boolean) { this.file = path.join(home, 'tool-governance.json'); }
  async init() {
    try { const stat = await fs.stat(this.file); if (stat.size > 4 * 1024 * 1024) throw new Error('oversized'); this.state = stateSchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8'))); this.unavailable = null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.unavailable = null; else this.unavailable = 'Governance audit state is unreadable; preserve it and repair before execution'; }
  }
  view(): ToolGovernanceView { return { ...structuredClone(this.state), scope: 'request-local-safeguards', unavailableReason: this.unavailable, tenantPolicyVerified: false, note: 'Observed checkpoints, not a percentage of all runtime tool calls. Trusted pre-tool hooks are required; unhooked runtimes are outside enforcement.' }; }
  check(name: string, input: unknown, checkpoint: ToolCheckpoint): Promise<ToolDecision> {
    return this.writer.write(async () => {
      if (this.unavailable) return { status: 'unavailable', reason: this.unavailable };
      const copilotPaused = this.paused();
      const decision = evaluateToolRequest(name, input, copilotPaused);
      let serialized: string; try { serialized = JSON.stringify(input) ?? 'null'; } catch { serialized = 'uninspectable'; }
      const entry = entrySchema.parse({ id: crypto.randomUUID(), at: new Date().toISOString(), actor: checkpoint.actor, runtime: checkpoint.runtime, source: checkpoint.source, tool: /^[\w.:-]{1,200}$/.test(name) ? name : 'invalid-tool', inputSha256: crypto.createHash('sha256').update(serialized).digest('hex'), ruleVersion, copilotPaused, ...decision });
      const next = { ...this.state, evaluated: this.state.evaluated + 1, blocked: this.state.blocked + Number(decision.status === 'blocked'), unavailable: this.state.unavailable + Number(decision.status === 'unavailable'), recent: [...this.state.recent.slice(-99), entry] };
      try { await atomicWrite(this.file, JSON.stringify(next, null, 2)); this.state = next; return decision; }
      catch { this.unavailable = 'Governance audit could not be saved; execution denied'; return { status: 'unavailable', reason: this.unavailable }; }
    });
  }
}
