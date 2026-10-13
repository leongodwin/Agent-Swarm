import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CapabilityService, capabilityConfigSchema, runCapabilityProbe, versionAtLeast, matchesObservation, connectedAccount, azureResource } from './capabilityChecks.ts';
import { deliveryCommands } from './delivery.ts';

it('matches licence and provisioning status on the same SKU regardless of response order', () => {
  const required = [{ skuId: 'premium', servicePlans: [{ servicePlanName: 'POWERAPPS_PER_USER', provisioningStatus: 'Success' }] }];
  expect(matchesObservation([{ skuId: 'other' }, { skuId: 'premium', servicePlans: [{ servicePlanName: 'POWERAPPS_PER_USER', provisioningStatus: 'Success' }] }], required)).toBe(true);
  expect(matchesObservation([{ skuId: 'premium', servicePlans: [{ servicePlanName: 'POWERAPPS_PER_USER', provisioningStatus: 'Disabled' }] }, { skuId: 'other', servicePlans: required[0].servicePlans }], required)).toBe(false);
  expect(matchesObservation([], [])).toBe(false);
  expect(matchesObservation({}, {})).toBe(false);
});
it('requires a connected connector for the intended account and connection ID', () => {
  const output = 'old  other@example.com  /providers/Microsoft.PowerApps/apis/shared_office365  Connected\ncurrent  maker@example.com  /providers/Microsoft.PowerApps/apis/shared_office365  Error\nvalid  maker@example.com  /providers/Microsoft.PowerApps/apis/shared_office365users  Connected';
  expect(connectedAccount(output, 'shared_office365', 'maker@example.com')).toBe(false);
  expect(connectedAccount(output, 'shared_office365users', 'maker@example.com', 'valid')).toBe(true);
  expect(connectedAccount(output, 'shared_office365users', 'maker@example.com', 'old')).toBe(false);
  expect(connectedAccount('dataverse-id  maker@example.com  /providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps Connected', 'shared_commondataserviceforapps', 'maker@example.com', 'dataverse-id')).toBe(true);
  expect(connectedAccount('approvals-id  Standard approvals  /providers/Microsoft.PowerApps/apis/shared_approvals Connected', 'shared_approvals', undefined, 'approvals-id')).toBe(true);
  expect(connectedAccount(output, 'shared_office365users')).toBe(false);
});
it('does not obtain or send Azure tokens to arbitrary destinations or for a different account', async () => {
  expect(azureResource('https://graph.microsoft.com.evil.test/me')).toBeUndefined();
  expect(azureResource('http://graph.microsoft.com/me')).toBeUndefined();
  expect(azureResource('https://graph.microsoft.com/v1.0/me')).toBe('https://graph.microsoft.com/');
  const run = vi.spyOn(deliveryCommands, 'run').mockResolvedValue(JSON.stringify({ tenantId: '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c', user: { name: 'other@example.com' } }));
  const check = { id: 'auth', category: 'authentication' as const, remedy: 'Sign in as the project owner', probe: { kind: 'http' as const, url: 'https://graph.microsoft.com/v1.0/me', pointer: ['userPrincipalName'], equals: 'maker@example.com', azureCli: { tenantId: '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c', username: 'maker@example.com' } } };
  await expect(runCapabilityProbe(check, process.cwd(), AbortSignal.timeout(1000))).rejects.toThrow('identity');
  expect(run).toHaveBeenCalledTimes(1);
});

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); });
const target = 'https://test.crm4.dynamics.com';
const config = capabilityConfigSchema.parse({ environmentUrl: target, checks: ['authentication', 'environment', 'licence', 'mcp', 'cli', 'connector'].map((category) => ({ id: category, category, remedy: `Reconnect the ${category} capability`, probe: category === 'cli' ? { kind: 'cli', executable: 'node', minimumVersion: '22.0.0' } : category === 'mcp' ? { kind: 'mcp', url: 'http://localhost:1234/mcp', tools: ['compile_canvas'] } : { kind: 'http', url: 'https://provider.test/status', pointer: [category], equals: true } })) });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-capabilities-')); dirs.push(root); const probe = vi.fn<typeof runCapabilityProbe>(async () => {}); const service = new CapabilityService(root, false, probe); await service.init(); return { root, probe, service }; }

it('rejects malformed or contradictory saved capability state without running probes or replacing its bytes',async()=>{
  const {root,probe}=await fixture();const file=path.join(root,'capabilities.json');
  const checkedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
  const good={repoId:'repo',checkedAt,expiresAt,status:'ready',checks:[{id:'worker-cli',category:'cli',passed:true,detail:'Observed',remedy:''}]};
  const badConfig={...config,checks:config.checks.map(check=>check.category==='cli'?{...check,probe:{kind:'cli',executable:'unapproved-executable',minimumVersion:'1.0.0'}}:check)};
  for(const raw of ['broken JSON','null','[]','{"configs":{"__proto__":{}},"results":{}}','{"configs":{"constructor":{}},"results":{}}',JSON.stringify({configs:{repo:badConfig},results:{}}),JSON.stringify({configs:{},results:{},schemaVersion:99}),
    JSON.stringify({configs:{},results:{repo:{...good,checks:[]}}}),JSON.stringify({configs:{},results:{repo:{...good,repoId:'different-project'}}}),
    JSON.stringify({configs:{},results:{repo:{...good,expiresAt:checkedAt}}}),JSON.stringify({configs:{},results:{repo:{...good,checks:[{...good.checks[0],passed:false}]}}}),
    JSON.stringify({configs:{},results:{repo:{...good,checks:[...good.checks,...good.checks]}}})]) {
    await fs.writeFile(file,raw);const restored=new CapabilityService(root,false,probe);
    await expect(restored.init()).rejects.toThrow('preserve and repair');
    await expect(restored.check('repo',root,target)).rejects.toThrow('not initialized');
    await expect(restored.configure('repo',config)).rejects.toThrow('not initialized');
    await restored.close();expect(await fs.readFile(file,'utf8')).toBe(raw);
  }
  expect(probe).not.toHaveBeenCalled();
});

it('restores valid plans while treating saved readiness as historical until live checks complete',async()=>{
  const {root,service}=await fixture();await service.configure('repo',config);await service.check('repo',root,target);
  const probe=vi.fn<typeof runCapabilityProbe>(async()=>{});const restored=new CapabilityService(root,false,probe);
  await restored.init();await restored.init();
  expect(restored.view().configuredProjects).toEqual(['repo']);
  expect(restored.view().results[0]).toMatchObject({status:'blocked'});
  expect(restored.view().results[0].checks.at(-1)?.id).toBe('current-evidence');expect(probe).not.toHaveBeenCalled();
  expect((await restored.check('repo',root,target)).status).toBe('ready');expect(restored.view().results[0].status).toBe('ready');
  await restored.close();await expect(restored.init()).rejects.toThrow('closing');
});

it('preserves oversized capability state and rejects a file that disappears after discovery',async()=>{
  const {root,probe}=await fixture();const file=path.join(root,'capabilities.json');
  await fs.writeFile(file,'x'.repeat(4*1024*1024+1));const large=new CapabilityService(root,false,probe);
  await expect(large.init()).rejects.toThrow('preserve and repair');expect((await fs.stat(file)).size).toBe(4*1024*1024+1);
  await fs.writeFile(file,JSON.stringify({configs:{},results:{}}));
  const read=vi.spyOn(fs,'readFile').mockRejectedValueOnce(Object.assign(new Error('disappeared'),{code:'ENOENT'}));
  const missing=new CapabilityService(root,false,probe);await expect(missing.init()).rejects.toThrow('preserve and repair');read.mockRestore();
  expect(probe).not.toHaveBeenCalled();
});

it('does not present expired or future-dated runtime observations as ready',async()=>{
  const {root,service}=await fixture();await service.configure('repo',config);vi.useFakeTimers();
  try {
    await service.check('repo',root,target);expect(service.view().results[0].status).toBe('ready');
    const observed=Date.now();await vi.advanceTimersByTimeAsync(60001);expect(service.view().results[0].status).toBe('blocked');
    vi.setSystemTime(observed-60000);expect(service.view().results[0].status).toBe('blocked');
    expect((await service.check('repo',root,target)).status).toBe('ready');
  } finally {vi.useRealTimers();}
});

it('rejects configured check IDs that would collide with automatic or freshness evidence',()=>{
  for(const id of ['configuration','configuration-changed','github-auth','worker-cli','current-evidence']) {
    expect(capabilityConfigSchema.safeParse({...config,checks:config.checks.map((check,index)=>index===0?{...check,id}:check)}).success).toBe(false);
  }
});

it('blocks unknown Power Platform capabilities without claiming readiness from installed skills', async () => {
  const { root, service } = await fixture();
  const result = await service.check('repo', root, target);
  expect(result.status).toBe('blocked'); expect(result.checks[0].id).toBe('configuration');
});
it('deduplicates probes, caches by environment/CLI/config and persists blockers without secrets', async () => {
  const { root, service, probe } = await fixture(); await service.configure('repo', config);
  probe.mockImplementation(async (check) => { if ((check as { category: string }).category === 'licence') throw new Error('SECRET_DO_NOT_STORE'); });
  const changed = vi.fn(); service.onChange = changed;
  const [first, second] = await Promise.all([service.check('repo', root, target), service.check('repo', root, target)]);
  expect(first.status).toBe('blocked'); expect(second.checks).toEqual(first.checks);
  const count = probe.mock.calls.length; await service.check('repo', root, target); expect(probe).toHaveBeenCalledTimes(count);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(path.join(root, 'capabilities.json'), 'utf8')).not.toContain('SECRET_DO_NOT_STORE');
  probe.mockImplementation(async () => {}); expect((await service.check('repo', root, target, 'git', true)).status).toBe('ready');
  expect((await service.check('repo', root, 'https://other.crm4.dynamics.com')).status).toBe('blocked');
});
it('binds scoped admission to configuration without invalidation from probe results or unrelated projects', async () => {
  const { root, service } = await fixture();
  const missing = service.configurationFingerprint(['repo']);
  await service.configure('repo', config);
  const bound = service.configurationFingerprint(['repo']); expect(bound).not.toBe(missing);
  await service.check('repo', root, target); expect(service.configurationFingerprint(['repo'])).toBe(bound);
  await service.configure('other', config); expect(service.configurationFingerprint(['repo'])).toBe(bound);
  expect(service.configurationFingerprint(['repo', 'other', 'repo'])).toBe(service.configurationFingerprint(['other', 'repo']));
  await service.configure('repo', {...config, environmentUrl: 'https://changed.crm4.dynamics.com'});
  expect(service.configurationFingerprint(['repo'])).not.toBe(bound);
});

it('does not reuse capability evidence from another workspace for the same project and runtime',async()=>{
  const {root,service,probe}=await fixture();await service.configure('repo',config);
  await service.check('repo',root,target,'node');const checked=probe.mock.calls.length;
  await service.check('repo',path.join(root,'.'),target,'node');expect(probe).toHaveBeenCalledTimes(checked);
  const moved=path.join(root,'moved-workspace');await service.check('repo',moved,target,'node');
  expect(probe.mock.calls.length).toBeGreaterThan(checked);
  expect(probe.mock.calls.at(-1)?.[1]).toBe(moved);
});

it('retains independent cached prerequisites for mixed runtimes and invalidates every scope on configuration change',async()=>{
  const {root,service,probe}=await fixture();await service.configure('repo',config);
  await service.check('repo',root,target,'node');await service.check('repo',root,target,'codex');
  const count=probe.mock.calls.length;
  await service.check('repo',root,target,'node');await service.check('repo',root,target,'codex');
  expect(probe).toHaveBeenCalledTimes(count);
  await service.configure('repo',config);
  await service.check('repo',root,target,'node');await service.check('repo',root,target,'codex');
  expect(probe.mock.calls.length).toBe(count*2);
});

it('refreshes expired capability evidence instead of authorizing with an old cached observation',async()=>{
  const {root,service,probe}=await fixture();await service.configure('repo',config);
  vi.useFakeTimers();
  try {
    await service.check('repo',root,target,'node');const count=probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60001);
    probe.mockImplementation(async()=>{throw new Error('Synthetic credentials expired');});
    const expired=await service.check('repo',root,target,'node');
    expect(expired.status).toBe('blocked');expect(probe.mock.calls.length).toBeGreaterThan(count);
  } finally {vi.useRealTimers();}
});
it('rejects incomplete plans, ambiguous MCP transports and workflow checks without freshness', () => {
  expect(capabilityConfigSchema.safeParse({ ...config, checks: config.checks.slice(1) }).success).toBe(false);
  expect(capabilityConfigSchema.safeParse({ ...config, checks: [...config.checks, { id: 'flow', category: 'workflow', remedy: 'Repair flow and inspect run history', probe: { kind: 'http', url: 'https://provider.test/status', pointer: ['ok'], equals: true } }] }).success).toBe(false);
  expect(versionAtLeast('PAC CLI 1.40.2', '1.39.9')).toBe(true);
  expect(versionAtLeast('v1.9.9', '1.10.0')).toBe(false);
  expect(versionAtLeast('not installed', '1.0.0')).toBe(false);
});
it('requires live HTTP assertions and rejects stale workflow observations', async () => {
  let observedAt = new Date().toISOString(); let ok = true;
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok, observedAt })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/status`;
    const check = { id: 'flow', category: 'workflow' as const, remedy: 'Inspect the critical flow', probe: { kind: 'http' as const, url, pointer: ['ok'], equals: true, freshness: { pointer: ['observedAt'], maxAgeSeconds: 60 } } };
    await runCapabilityProbe(check, process.cwd(), AbortSignal.timeout(1000));
    observedAt = '2020-01-01T00:00:00Z'; await expect(runCapabilityProbe(check, process.cwd(), AbortSignal.timeout(1000))).rejects.toThrow('stale');
    ok = false; await expect(runCapabilityProbe(check, process.cwd(), AbortSignal.timeout(1000))).rejects.toThrow('assertion');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
it('demo never calls external probes or writes real configuration', async () => {
  const { root, probe } = await fixture(); const demo = new CapabilityService(root, true, probe); await demo.init();
  await demo.check('repo', root, target); expect(probe).not.toHaveBeenCalled();
  await expect(demo.configure('repo', config)).rejects.toThrow('Demo');
});

it('negotiates a real MCP stdio connection and refuses missing required tools', async () => {
  const { root } = await fixture(); const require = createRequire(import.meta.url);
  const file = path.join(root, 'mcp-fixture.mjs');
  await fs.writeFile(file, `import { McpServer } from ${JSON.stringify(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href)};
import { StdioServerTransport } from ${JSON.stringify(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href)};
const server = new McpServer({name:'fixture',version:'1'});
server.registerTool('compile_canvas', {inputSchema:{}}, async () => ({content:[{type:'text',text:'Never invoked by readiness'}]}));
await server.connect(new StdioServerTransport());`);
  const check = { id: 'mcp', category: 'mcp' as const, remedy: 'Connect Canvas Authoring', probe: { kind: 'mcp' as const, command: process.execPath, args: [file], tools: ['compile_canvas'] } };
  await runCapabilityProbe(check, root, AbortSignal.timeout(10000));
  await expect(runCapabilityProbe({ ...check, probe: { ...check.probe, tools: ['missing_tool'] } }, root, AbortSignal.timeout(10000))).rejects.toThrow('Required MCP tools');
}, 30000);
