import {verifyGeminiProfile} from './geminiBridge.ts';
import {commandFor} from './clis.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomicWrite, SerialWriter } from './atomicFile.ts';
import { deliveryCommands } from './delivery.ts';
import { HttpError } from './httpError.ts';
import { platformIdentitySchema, verifyPlatformAuthentication } from './platformAuth.ts';
import { targetBindingSchema, type Request } from './targetOperations.ts';
import { connectFlowAdapter } from './flowAdapter.ts';

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const category = z.enum(['authentication', 'environment', 'licence', 'mcp', 'cli', 'connector', 'workflow']);
const endpoint = z.url().refine((v) => { const u = new URL(v); return !u.username && !u.password && (u.protocol === 'https:' || u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)); });
const azureCli = z.object({ tenantId: z.uuid(), username: z.email() }).strict();
const pendingReads = new Map<string, Promise<string>>();
function sharedRead(executable: string, args: string[], cwd: string, signal: AbortSignal) {
  const key = JSON.stringify([executable, args, cwd]);
  let request = pendingReads.get(key);
  if (!request) {
    request = deliveryCommands.run({ executable, args }, cwd, {}, signal).finally(() => pendingReads.delete(key));
    pendingReads.set(key, request);
  }
  return request;
}
const probe = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('platform-auth'), environmentUrl: endpoint, binding: targetBindingSchema, identity: platformIdentitySchema, includeFlow: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('github-auth') }).strict(),
  z.object({ kind: z.literal('http'), url: endpoint, tokenEnv: key.optional(), azureCli: azureCli.optional(), pointer: z.array(z.string()).min(1), equals: z.union([z.string(), z.number(), z.boolean()]).optional(), matches: z.json().optional(), freshness: z.object({ pointer: z.array(z.string()).min(1), maxAgeSeconds: z.number().int().min(60).max(86400) }).strict().optional() }).strict(),
  z.object({ kind: z.literal('pac-connection'), environmentUrl: endpoint, api: z.string().regex(/^shared_[a-z0-9]+$/), account: z.email().optional(), connectionId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional() }).strict(),
  z.object({ kind: z.literal('mcp'), url: endpoint.optional(), command: z.string().min(1).optional(), args: z.array(z.string()).default([]), tokenEnv: key.optional(), tools: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('cli'), executable: z.enum(['git', 'gh', 'pac', 'node', 'dotnet', 'codex', 'gemini', 'opencode']), minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
]);
export const capabilityConfigSchema = z.object({
  environmentUrl: endpoint,
  checks: z.array(z.object({ id: key, category, remedy: z.string().min(10).max(1000), probe }).strict()).min(6).max(30),
}).strict().superRefine((config, ctx) => {
  for (const kind of category.options.filter((kind) => kind !== 'workflow')) if (!config.checks.some((c) => c.category === kind)) ctx.addIssue({ code: 'custom', message: `Missing ${kind} capability check` });
  if (new Set(config.checks.map((c) => c.id)).size !== config.checks.length) ctx.addIssue({ code: 'custom', message: 'Duplicate check IDs' });
  if (config.checks.some(check => ['configuration', 'configuration-changed', 'github-auth', 'worker-cli', 'current-evidence'].includes(check.id))) ctx.addIssue({code:'custom',message:'Check ID is reserved for system evidence'});
  for (const check of config.checks) {
    if (check.category === 'mcp' && check.probe.kind !== 'mcp' || check.category === 'cli' && check.probe.kind !== 'cli' || ['authentication', 'environment'].includes(check.category) && !['http', 'platform-auth'].includes(check.probe.kind) || ['licence', 'workflow'].includes(check.category) && check.probe.kind !== 'http' || check.category === 'connector' && !['http', 'pac-connection'].includes(check.probe.kind)) ctx.addIssue({ code: 'custom', message: `Use a live ${check.category} probe for ${check.id}` });
    if (check.probe.kind === 'platform-auth' && new URL(check.probe.environmentUrl).origin !== new URL(config.environmentUrl).origin) ctx.addIssue({ code: 'custom', message: 'Platform authentication must target the project environment' });
    if (check.probe.kind === 'pac-connection' && new URL(check.probe.environmentUrl).origin !== new URL(config.environmentUrl).origin) ctx.addIssue({ code: 'custom', message: 'Connection probe must target the project environment' });
    if (check.probe.kind === 'pac-connection' && !check.probe.account && !check.probe.connectionId) ctx.addIssue({ code: 'custom', message: 'Pin a verified connection ID or account' });
    if (check.probe.kind === 'http') {
      if ((check.probe.equals === undefined) === (check.probe.matches === undefined)) ctx.addIssue({ code: 'custom', message: 'Choose exactly one HTTP assertion' });
      if (check.probe.azureCli && check.probe.tokenEnv) ctx.addIssue({ code: 'custom', message: 'Choose one credential source' });
      if (check.probe.azureCli && !azureResource(check.probe.url)) ctx.addIssue({ code: 'custom', message: 'Azure credentials require an approved Microsoft HTTPS endpoint' });
    }
    if (check.category === 'workflow' && (check.probe.kind !== 'http' || !check.probe.freshness)) ctx.addIssue({ code: 'custom', message: 'Workflow health must assert a fresh successful observation' });
    if (check.probe.kind === 'mcp' && !!check.probe.url === !!check.probe.command) ctx.addIssue({ code: 'custom', message: 'Choose one MCP transport' });
  }
});
export type CapabilityConfig = z.infer<typeof capabilityConfigSchema>;
export interface CapabilityResult { repoId: string; checkedAt: string; expiresAt: string; status: 'ready' | 'blocked'; configHash?: string; checks: { id: string; category: string; passed: boolean; detail: string; remedy: string }[] }
const projectKey = z.string().min(1).max(240).refine(id => !['__proto__', 'prototype', 'constructor'].includes(id) && !/[\x00-\x1f]/.test(id));
const resultSchema = z.object({repoId: projectKey, checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), status: z.enum(['ready','blocked']), configHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  checks: z.array(z.object({id: key, category, passed: z.boolean(), detail: z.string().max(2000), remedy: z.string().max(1000)}).strict()).min(1).max(40),
}).strict().superRefine((result, context) => {
  const duration = Date.parse(result.expiresAt) - Date.parse(result.checkedAt);
  if (duration <= 0 || duration > 65_000) context.addIssue({code:'custom',message:'Invalid capability observation lifetime'});
  if ((result.status === 'ready') !== result.checks.every(check => check.passed)) context.addIssue({code:'custom',message:'Capability status contradicts its checks'});
  if (new Set(result.checks.map(check => check.id)).size !== result.checks.length) context.addIssue({code:'custom',message:'Duplicate capability evidence checks'});
});
const savedSchema = z.object({configs: z.record(projectKey, capabilityConfigSchema), results: z.record(projectKey, resultSchema)}).strict().superRefine((saved, context) => {
  if (Object.keys(saved.configs).length > 1024 || Object.keys(saved.results).length > 1024) context.addIssue({code:'custom',message:'Capability state exceeds project limit'});
  for (const [id, result] of Object.entries(saved.results)) if (result.repoId !== id) context.addIssue({code:'custom',message:'Capability evidence belongs to another project'});
});
function currentObservation(result: CapabilityResult) {
  const now = Date.now(), checked = Date.parse(result.checkedAt), expires = Date.parse(result.expiresAt);
  return checked <= now + 30_000 && now - checked <= 60_000 && expires > now;
}

export function capabilityBlocker(result: Pick<CapabilityResult, 'status' | 'checks'>): string | null {
  if (result.status === 'ready' && result.checks.length > 0 && result.checks.every(check => check.passed)) return null;
  return result.checks.filter(check => !check.passed).map(check => `${check.id}: ${check.remedy}`).join('; ') || 'Capability verification is not ready; refresh project readiness';
}
export function azureResource(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return undefined;
  if (['graph.microsoft.com', 'api.powerplatform.com'].includes(u.hostname) || /^[a-z0-9-]+\.crm\d*\.dynamics\.com$/.test(u.hostname)) return `${u.origin}/`;
  return undefined;
}
/** Every expected array member must match one complete observed record. Never
 * combine a SKU from one licence with a successful plan from another licence. */
export function matchesObservation(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return expected.length > 0 && Array.isArray(actual) && expected.every((item) => actual.some((row) => matchesObservation(row, item)));
  if (expected && typeof expected === 'object') return !!actual && typeof actual === 'object' && !Array.isArray(actual) && Object.keys(expected).length > 0 && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && matchesObservation((actual as Record<string, unknown>)[key], value));
  return actual === expected;
}
export function connectedAccount(output: string, api: string, account?: string, id?: string) {
  if (!account && !id) return false;
  return output.split(/\r?\n/).some((line) => {
    const fields = line.trim().match(/^(\S+)\s{2,}(.+?)\s{2,}(\/providers\/Microsoft\.PowerApps\/apis\/\S+)\s+(\S+)$/);
    return !!fields && (!id || fields[1] === id) && (!account || fields[2].toLowerCase() === account.toLowerCase()) && fields[3] === `/providers/Microsoft.PowerApps/apis/${api}` && fields[4] === 'Connected';
  });
}
export function versionAtLeast(output: string, minimum: string) {
  const match = output.match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:[^\d]|$)/);
  if (!match) return false;
  const actual = match.slice(1).map(Number), required = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (actual[i] !== required[i]) return actual[i] > required[i];
  return true;
}
export async function runCapabilityProbe(check: CapabilityConfig['checks'][number], cwd: string, signal: AbortSignal, officeRoot?: string) {
  signal.throwIfAborted();
  const p = check.probe;
  if (p.kind === 'platform-auth') {
    const command = (executable: string, args: string[]) => sharedRead(executable, args, cwd, signal);
    const request: Request = async (method, resource) => JSON.parse(await command('dataverse', ['api', 'request', '--target', 'dataverse', '--environment', p.environmentUrl, '--method', method, '--path', `/api/data/v9.2/${resource}`]));
    const flow = p.includeFlow ? await connectFlowAdapter(cwd, signal) : undefined;
    try { await verifyPlatformAuthentication(command, request, p.environmentUrl, p.binding, p.identity, flow ? () => flow.call('whoami', {}) : undefined); }
    finally { await flow?.close(); }
    return;
  }
  const dotnet = officeRoot ? path.join(officeRoot, 'tools', 'dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet') : undefined;
  const privateSdk = dotnet && await fs.access(dotnet).then(() => true, () => false) ? dotnet : undefined;
  if (p.kind === 'github-auth') { await deliveryCommands.run({ executable: 'gh', args: ['auth', 'status'] }, cwd, {}, signal); return; }
  if (p.kind === 'pac-connection') {
    const output = await sharedRead('pac', ['connection', 'list', '--environment', p.environmentUrl], cwd, signal);
    if (!connectedAccount(output, p.api, p.account, p.connectionId)) throw new Error('Required account connection is missing or disconnected');
    return;
  }
  if (p.kind === 'cli') {
    const output = await deliveryCommands.run({ executable: p.executable === 'dotnet' && privateSdk ? privateSdk : p.executable, args: [p.executable === 'pac' ? 'help' : '--version'] }, cwd, {}, signal);
    if (!versionAtLeast(output, p.minimumVersion)) throw new Error('Required CLI version is unavailable');
    return;
  }
  let token = p.tokenEnv ? process.env[p.tokenEnv] : undefined;
  if (p.tokenEnv && !token) throw new Error('Credential is not connected');
  if (p.kind === 'http' && p.azureCli) {
    const resource = azureResource(p.url); if (!resource) throw new Error('Unapproved Azure token destination');
    const account = JSON.parse(await sharedRead('az', ['account', 'show', '--output', 'json'], cwd, signal));
    if (account.tenantId?.toLowerCase() !== p.azureCli.tenantId.toLowerCase() || account.user?.name?.toLowerCase() !== p.azureCli.username.toLowerCase()) throw new Error('Azure CLI identity does not match the project');
    const credentials = JSON.parse(await sharedRead('az', ['account', 'get-access-token', '--resource', resource, '--tenant', p.azureCli.tenantId, '--output', 'json'], cwd, signal));
    if (credentials.tenant?.toLowerCase() !== p.azureCli.tenantId.toLowerCase() || typeof credentials.accessToken !== 'string' || !credentials.accessToken) throw new Error('Azure CLI did not return the expected tenant token');
    token = credentials.accessToken;
    const claims = JSON.parse(Buffer.from(token!.split('.')[1] ?? '', 'base64url').toString());
    if (claims.tid?.toLowerCase() !== p.azureCli.tenantId.toLowerCase() || String(claims.preferred_username ?? claims.upn ?? claims.unique_name ?? '').toLowerCase() !== p.azureCli.username.toLowerCase()) throw new Error('Azure token identity does not match the project');
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  if (p.kind === 'http') {
    const response = await fetch(p.url, { headers, signal, redirect: 'error' });
    if (!response.ok) throw new Error('Capability endpoint refused the request');
    const body = await response.text(); if (body.length > 1024 * 1024) throw new Error('Capability response is too large');
    const data = JSON.parse(body); let value: unknown = data;
    for (const part of p.pointer) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
    if (p.matches !== undefined ? !matchesObservation(value, p.matches) : value !== p.equals) throw new Error('Capability assertion did not match');
    if (p.freshness) { let timestamp: unknown = data; for (const part of p.freshness.pointer) timestamp = timestamp && typeof timestamp === 'object' ? (timestamp as Record<string, unknown>)[part] : undefined; const time = Date.parse(String(timestamp)); if (!Number.isFinite(time) || time > Date.now() + 60000 || time < Date.now() - p.freshness.maxAgeSeconds * 1000) throw new Error('Workflow observation is stale'); }
    return;
  }
  const client = new Client({ name: 'swarm-capability-check', version: '1' });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/^(ANTHROPIC_|CLAUDE_)/.test(name))) as Record<string, string>;
  if (privateSdk) { const dir = path.dirname(privateSdk); const pathKey = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'; env[pathKey] = `${dir}${path.delimiter}${env[pathKey] ?? ''}`; env.DOTNET_ROOT = dir; }
  const transport = p.url ? new StreamableHTTPClientTransport(new URL(p.url), { requestInit: { headers, signal } }) : new StdioClientTransport({ command: p.command!, args: p.args, env, stderr: 'ignore', cwd });
  const abort = () => { void transport.close(); }; signal.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport, { timeout: 12_000 });
    const names = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) { const list = await client.listTools({ cursor }, { signal, timeout: 12_000 }); for (const tool of list.tools) names.add(tool.name); cursor = list.nextCursor; if (!cursor) break; }
    if (p.tools.some((tool) => !names.has(tool))) throw new Error('Required MCP tools are unavailable');
  } finally { signal.removeEventListener('abort', abort); await client.close(); await transport.close(); }
}

/** Cached readiness is scoped to project, environment, config and worker CLI. Secrets never enter results. */
export class CapabilityService {
  private configs: Record<string, CapabilityConfig> = {};
  private results: Record<string, CapabilityResult> = {};
  private cache = new Map<string, { key: string; result: CapabilityResult }>();
  private pending = new Map<string, Promise<CapabilityResult>>();
  private writer = new SerialWriter();
  private stop = new AbortController();
  private initialized = false;
  private liveResults = new Set<string>();
  onChange = () => {};
  constructor(private root: string, private demo: boolean, private probe = runCapabilityProbe) {}
  async init() {
    if (this.stop.signal.aborted) throw new Error('Capability service is closing');
    if (this.initialized) return;
    if (this.demo) {this.initialized = true; return;}
    let found = false;
    try {
      const file = path.join(this.root, 'capabilities.json');
      if ((await fs.stat(file)).size > 4 * 1024 * 1024) {found = true; throw new Error('oversized');}
      found = true;
      const raw = await fs.readFile(file, 'utf8');
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('oversized');
      const input = JSON.parse(raw);
      for (const map of [input?.configs, input?.results]) if (map && typeof map === 'object') {
        const keys = Object.keys(map);
        if (keys.length > 1024) throw new Error('oversized project map');
        for (const id of keys) projectKey.parse(id); // parsers may otherwise discard reserved prototype keys
      }
      const saved = savedSchema.parse(input); this.configs = saved.configs; this.results = saved.results;
    } catch (error) { if (found || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Capability state is unreadable or invalid; preserve and repair capabilities.json before execution'); }
    this.initialized = true;
  }
  private save() { return this.writer.write(() => atomicWrite(path.join(this.root, 'capabilities.json'), JSON.stringify({ configs: this.configs, results: this.results }, null, 2))); }
  view() {
    const results = Object.values(this.results).map(result => {
      if (this.liveResults.has(result.repoId) && currentObservation(result)) return result;
      return {...result, status: 'blocked' as const, checks: [...result.checks, {id:'current-evidence', category:'environment', passed:false, detail:'Saved or expired observation is not current verification', remedy:'Refresh capability checks in this office process'}]};
    });
    return structuredClone({results, configuredProjects: Object.keys(this.configs)});
  }
  configurationFingerprint(repoIds: string[]) {
    return crypto.createHash('sha256').update(JSON.stringify([...new Set(repoIds)].sort().map(id => [id, this.configs[id] ?? null]))).digest('hex');
  }
  async configure(repoId: string, input: unknown) {
    if (!this.initialized) throw new Error('Capability state is not initialized; preserve and repair before execution');
    projectKey.parse(repoId);
    if (this.stop.signal.aborted) throw new Error('Capability service is closing');
    if (this.demo) throw new HttpError(409, 'Demo cannot configure live capability probes');
    this.configs[repoId] = capabilityConfigSchema.parse(input);
    this.liveResults.delete(repoId);
    for (const [key, entry] of this.cache) if (entry.result.repoId === repoId) this.cache.delete(key);
    delete this.results[repoId]; await this.save(); this.onChange();
  }
  async check(repoId: string, cwd: string, environmentUrl: string | undefined, cli = 'git', force = false): Promise<CapabilityResult> {
    if (!this.initialized) throw new Error('Capability state is not initialized; preserve and repair before execution');
    projectKey.parse(repoId);
    if (this.stop.signal.aborted) throw new Error('Capability service is closing');
    if (this.demo) return { repoId, status: 'ready', checkedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), checks: [] };
    const config = this.configs[repoId];
    const hash = crypto.createHash('sha256').update(JSON.stringify({ config, environmentUrl, cli, cwd: path.resolve(cwd) })).digest('hex');
    const pendingKey = `${repoId}:${hash}`;
    for (const [key, entry] of this.cache) if (!currentObservation(entry.result)) this.cache.delete(key);
    const cache = this.cache.get(pendingKey);
    if (!force && cache?.key === hash && Date.parse(cache.result.expiresAt) > Date.now()) return structuredClone(cache.result);
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey)!;
    const work = (async () => {
      const checks: CapabilityResult['checks'] = [];
      const probe = (check: CapabilityConfig['checks'][number]) => this.probe(check, cwd, AbortSignal.any([this.stop.signal, AbortSignal.timeout(15_000)]), this.root);
      if (environmentUrl && (!config || new URL(config.environmentUrl).origin !== new URL(environmentUrl).origin)) checks.push({ id: 'configuration', category: 'environment', passed: false, detail: 'No capability plan for this target', remedy: 'Configure authentication, environment, licence, MCP, CLI and connector probes in Solution delivery.' });
      else if (config) checks.push(...await Promise.all(config.checks.map(async (check) => {
        try { await probe(check); return { id: check.id, category: check.category, passed: true, detail: 'Live probe passed', remedy: check.remedy }; }
        catch { return { id: check.id, category: check.category, passed: false, detail: 'Live probe failed or access is unknown', remedy: check.remedy }; }
      })));
      try { await probe({ id: 'github-auth', category: 'authentication', remedy: 'Sign in with gh auth login', probe: { kind: 'github-auth' } }); checks.push({ id: 'github-auth', category: 'authentication', passed: true, detail: 'GitHub authentication verified', remedy: '' }); }
      catch { checks.push({ id: 'github-auth', category: 'authentication', passed: false, detail: 'GitHub authentication unavailable', remedy: 'Sign in with gh auth login and refresh readiness.' }); }
      if(cli==='gemini'){const blocker=await verifyGeminiProfile(commandFor('gemini')).catch(()=> 'Gemini protected profile validation is unavailable');checks.push({id:'gemini-governance',category:'cli',passed:blocker===null,detail:blocker??'Native protected-profile security validation passed; session attestation is still required',remedy:blocker?'Provision the reviewed administrator-owned Gemini governance artifacts':''});}
      const worker = ['codex', 'gemini', 'opencode', 'git', 'node'].includes(cli) ? cli : 'git';
      try { await probe({ id: 'worker-cli', category: 'cli', remedy: 'Install the selected worker CLI', probe: { kind: 'cli', executable: worker as 'git', minimumVersion: '0.0.1' } }); checks.push({ id: 'worker-cli', category: 'cli', passed: true, detail: 'Worker CLI responds', remedy: '' }); }
      catch { checks.push({ id: 'worker-cli', category: 'cli', passed: false, detail: 'Worker CLI is unavailable', remedy: 'Install the selected worker CLI and refresh readiness.' }); }
      if (JSON.stringify(config) !== JSON.stringify(this.configs[repoId])) checks.push({ id: 'configuration-changed', category: 'environment', passed: false, detail: 'Configuration changed during the check', remedy: 'Refresh readiness with the latest configuration' });
      const result: CapabilityResult = { repoId, configHash: crypto.createHash('sha256').update(JSON.stringify({ config, environmentUrl })).digest('hex'), checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), status: checks.every((c) => c.passed) ? 'ready' : 'blocked', checks };
      const changed = JSON.stringify(this.results[repoId]?.checks) !== JSON.stringify(result.checks);
      this.results[repoId] = result;
      this.liveResults.add(repoId);
      if (this.cache.size >= 1024) {const oldest = this.cache.keys().next().value; if (oldest !== undefined) this.cache.delete(oldest);}
      this.cache.set(pendingKey, { key: hash, result }); await this.save(); if (changed) this.onChange(); return structuredClone(result);
    })().finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, work); return work;
  }
  async close() { this.stop.abort(); await Promise.allSettled(this.pending.values()); await this.writer.drain(); }
}
