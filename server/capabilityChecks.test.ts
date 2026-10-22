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
it('accepts PAC connection columns with the single-space padding emitted for full-width cells', () => {
  const output = 'Id                            Name               API Id                                                              Status\r\n'
    + 'shared-commondataser-1f72b56f leon@graspai.co.uk /providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps Connected\r\n'
    + 'shared-approvals-69aa3963     Standard approvals /providers/Microsoft.PowerApps/apis/shared_approvals                Connected\r\n'
    + 'shared-office365-cf2c48f1     leon@graspai.co.uk /providers/Microsoft.PowerApps/apis/shared_office365                Connected';
  expect(connectedAccount(output, 'shared_office365', 'leon@graspai.co.uk', 'shared-office365-cf2c48f1')).toBe(true);
  expect(connectedAccount(output, 'shared_commondataserviceforapps', 'leon@graspai.co.uk', 'shared-commondataser-1f72b56f')).toBe(true);
  expect(connectedAccount(output, 'shared_approvals', undefined, 'shared-approvals-69aa3963')).toBe(true);
});
it('keeps single-space connection identity and status assertions on one complete row', () => {
  const output = 'wanted other@example.com /providers/Microsoft.PowerApps/apis/shared_office365 Connected\n'
    + 'different maker@example.com /providers/Microsoft.PowerApps/apis/shared_office365 Connected\n'
    + 'wanted maker@example.com /providers/Microsoft.PowerApps/apis/shared_office365 Error';
  expect(connectedAccount(output, 'shared_office365', 'maker@example.com', 'wanted')).toBe(false);
  expect(connectedAccount('wanted maker@example.com /providers/Microsoft.PowerApps/apis/shared_office365users Connected', 'shared_office365', 'maker@example.com', 'wanted')).toBe(false);
  expect(connectedAccount('wanted maker@example.com /providers/Microsoft.PowerApps/apis/shared_office365 Connected trailing', 'shared_office365', 'maker@example.com', 'wanted')).toBe(false);
  expect(connectedAccount('wanted maker@example.com /providers/Microsoft.PowerApps/apis/shared_office365 Connected', 'shared_office365')).toBe(false);
});
it('does not send Azure tokens to arbitrary destinations or for a different account', async () => {
  expect(azureResource('https://graph.microsoft.com.evil.test/me')).toBeUndefined();
  expect(azureResource('http://graph.microsoft.com/me')).toBeUndefined();
  expect(azureResource('https://graph.microsoft.com/v1.0/me')).toBe('https://graph.microsoft.com/');
  const run = vi.spyOn(deliveryCommands, 'run').mockResolvedValue(JSON.stringify({tenant:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',accessToken:'header.'+Buffer.from(JSON.stringify({tid:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',upn:'other@example.com'})).toString('base64url')+'.sig'}));
  const check = { id: 'auth', category: 'authentication' as const, remedy: 'Sign in as the project owner', probe: { kind: 'http' as const, url: 'https://graph.microsoft.com/v1.0/me', pointer: ['userPrincipalName'], equals: 'maker@example.com', azureCli: { tenantId: '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c', username: 'maker@example.com' } } };
  await expect(runCapabilityProbe(check, process.cwd(), AbortSignal.timeout(1000))).rejects.toThrow('identity');
  expect(run).toHaveBeenCalledTimes(1);
});

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); });
const target = 'https://test.crm4.dynamics.com';
const config = capabilityConfigSchema.parse({ environmentUrl: target, checks: ['authentication', 'environment', 'licence', 'mcp', 'cli', 'connector'].map((category) => ({ id: category, category, remedy: `Reconnect the ${category} capability`, probe: category === 'cli' ? { kind: 'cli', executable: 'node', minimumVersion: '22.0.0' } : category === 'mcp' ? { kind: 'mcp', url: 'http://localhost:1234/mcp', tools: ['compile_canvas'] } : { kind: 'http', url: 'https://provider.test/status', pointer: [category], equals: true } })) });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-capabilities-')); dirs.push(root); const probe = vi.fn<typeof runCapabilityProbe>(async () => {}); const service = new CapabilityService(root, false, probe); await service.init(); return { root, probe, service }; }
it('refuses aggregate UTF-8 snapshots above the startup limit while preserving readable acknowledged state',async()=>{
 const {root,service,probe}=await fixture(),file=path.join(root,'capabilities.json');
 const large={...config,checks:config.checks.map((check,index)=>index===0?{...check,probe:{...check.probe,equals:'£'.repeat(300000)}}:check)};
 for(let index=0;index<6;index++)await service.configure(`repo-${index}`,large);
 const before=await fs.readFile(file),fingerprint=service.configurationFingerprint(['repo-6']);expect(before.length).toBeLessThan(4*1024*1024);
 await expect(service.configure('repo-6',large)).rejects.toThrow('4 MiB');expect((await fs.readFile(file)).equals(before)).toBe(true);expect(service.configurationFingerprint(['repo-6'])).toBe(fingerprint);expect(service.view()).toMatchObject({unavailableKind:'limit'});expect(service.view().configuredProjects).toHaveLength(6);expect(probe).not.toHaveBeenCalled();
 const restored=new CapabilityService(root,false,probe);await restored.init();expect(restored.view().configuredProjects).toHaveLength(6);await restored.close();
 await service.configure('repo-0',config);expect(service.view().unavailableReason).toBeUndefined();expect((await service.check('repo-0',root,target)).status).toBe('ready');
},15000);
it('refuses processing-depth overflow before replacing the acknowledged snapshot',async()=>{
 const {root,service}=await fixture();await service.configure('repo',config);const file=path.join(root,'capabilities.json'),before=await fs.readFile(file);let nested:unknown=true;for(let index=0;index<251;index++)nested=[nested];
 const deep={...config,checks:config.checks.map((check,index)=>index===0?{...check,probe:{kind:'http',url:'https://provider.test/status',pointer:['result'],matches:nested}}:check)};
 await expect(service.configure('deep',deep)).rejects.toThrow('processing limit');expect(service.view().unavailableKind).toBe('limit');expect(await fs.readFile(file)).toEqual(before);expect(service.view().configuredProjects).toEqual(['repo']);
});
it('rejects malformed probe observations before writing an unreadable result',async()=>{
 const {root,service,probe}=await fixture();await service.configure('repo',config);const file=path.join(root,'capabilities.json'),before=await fs.readFile(file);
 probe.mockImplementation(async check=>{if(check.id==='licence')(check as any).remedy='x'.repeat(1001);});await expect(service.check('repo',root,target)).rejects.toThrow('snapshot is invalid');expect(service.view().unavailableKind).toBe('invalid');expect(await fs.readFile(file)).toEqual(before);expect(service.view().results).toEqual([]);
});
it('never reuses ready evidence after publication fails and requires fresh probes after repair',async()=>{
 const {root,service,probe}=await fixture();await service.configure('repo',config);await service.check('repo',root,target);const file=path.join(root,'capabilities.json'),before=await fs.readFile(file),count=probe.mock.calls.length,changed=vi.fn();service.onChange=changed;
 vi.spyOn(fs,'rename').mockRejectedValueOnce(new Error('private-storage-detail'));await expect(service.check('repo',root,target,'git',true)).rejects.toThrow('publication failed');
 expect(service.view()).toMatchObject({unavailableReason:expect.stringContaining('publication failed'),results:[{status:'blocked'}]});expect(JSON.stringify(service.view())).not.toContain('private-storage-detail');expect(await fs.readFile(file)).toEqual(before);expect(changed).toHaveBeenCalledOnce();
 const afterFailure=probe.mock.calls.length;expect(afterFailure).toBeGreaterThan(count);expect((await service.check('repo',root,target)).status).toBe('ready');expect(probe.mock.calls.length).toBeGreaterThan(afterFailure);expect(service.view().unavailableReason).toBeUndefined();
});
it('does not publish a failed configuration change to its live fingerprint or disk',async()=>{
 const {root,service}=await fixture();await service.configure('repo',config);await service.check('repo',root,target);const fingerprint=service.configurationFingerprint(['repo']),file=path.join(root,'capabilities.json'),before=await fs.readFile(file),updated={...config,environmentUrl:'https://changed.crm4.dynamics.com'};
 vi.spyOn(fs,'rename').mockRejectedValueOnce(new Error('private-storage-detail'));await expect(service.configure('repo',updated)).rejects.toThrow('publication failed');expect(service.configurationFingerprint(['repo'])).toBe(fingerprint);expect(await fs.readFile(file)).toEqual(before);expect(service.view().results[0].status).toBe('blocked');
 await service.configure('repo',updated);expect(service.configurationFingerprint(['repo'])).not.toBe(fingerprint);expect(service.view().unavailableReason).toBeUndefined();
});
async function holdRename(){
 const original=fs.rename;let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(fs,'rename').mockImplementationOnce(async(...args)=>{entered=true;await gate;return original(...args);});
 return {release,wait:()=>vi.waitFor(()=>expect(entered).toBe(true))};
}
it('publishes readiness only after acknowledged storage and isolates concurrent callers',async()=>{
 const {root,service}=await fixture();await service.configure('repo',config);const gate=await holdRename(),first=service.check('repo',root,target),second=service.check('repo',root,target);await gate.wait();expect(service.view().results).toEqual([]);gate.release();const [a,b]=await Promise.all([first,second]);expect(a.status).toBe('ready');expect(b.status).toBe('ready');a.status='blocked';a.checks[0].passed=false;expect(b.status).toBe('ready');expect(b.checks[0].passed).toBe(true);expect(service.view().results[0].status).toBe('ready');
});
it('rechecks configuration at publication after a queued configuration change',async()=>{
 const {root,service}=await fixture();await service.configure('repo',config);const fingerprint=service.configurationFingerprint(['repo']),gate=await holdRename(),configure=service.configure('repo',{...config,environmentUrl:'https://changed.crm4.dynamics.com'});await gate.wait();expect(service.configurationFingerprint(['repo'])).toBe(fingerprint);
 const check=service.check('repo',root,target);gate.release();await configure;const result=await check;expect(result.status).toBe('blocked');expect(result.checks.some(row=>row.id==='configuration-changed'&&!row.passed)).toBe(true);expect(service.view().results[0].status).toBe('blocked');
});
it('withholds readiness that expires while publication is awaiting acknowledgement',async()=>{
 const {root,service}=await fixture();await service.configure('repo',config);const gate=await holdRename(),check=service.check('repo',root,target);await gate.wait();vi.useFakeTimers();
 try{vi.setSystemTime(Date.now()+61000);gate.release();const result=await check;expect(result.status).toBe('blocked');expect(result.checks.some(row=>row.id==='current-evidence'&&!row.passed)).toBe(true);expect(service.view().results[0].status).toBe('blocked');}finally{vi.useRealTimers();}
});
it('cannot publish live readiness after shutdown begins during storage acknowledgement',async()=>{
 const {root,service}=await fixture();await service.configure('repo',config);const gate=await holdRename(),check=service.check('repo',root,target).then(()=>null,error=>error);await gate.wait();const close=service.close().then(()=>null,error=>error);gate.release();expect((await check).message).toContain('publication failed');expect((await close).message).toContain('publication failed');expect(service.view().results.every(row=>row.status==='blocked')).toBe(true);await expect(service.check('repo',root,target)).rejects.toThrow('closing');
});

it('rejects malformed or contradictory saved capability state without running probes or replacing its bytes',async()=>{
  const {root,probe}=await fixture();const file=path.join(root,'capabilities.json');
  const checkedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
  const good={repoId:'repo',checkedAt,expiresAt,status:'ready',checks:[{id:'worker-cli',category:'cli',passed:true,detail:'Observed',remedy:''}]};
  const badConfig={...config,checks:config.checks.map(check=>check.category==='cli'?{...check,probe:{kind:'cli',executable:'unapproved-executable',minimumVersion:'1.0.0'}}:check)};
  for(const raw of ['broken JSON','null','[]','{"configs":{"private":"unknown"},"configs":{},"results":{}}','{"configs":{},"results":{},"\\u0072esults":{}}','{"configs":{"__proto__":{}},"results":{}}','{"configs":{"constructor":{}},"results":{}}',JSON.stringify({configs:{repo:badConfig},results:{}}),JSON.stringify({configs:{},results:{},schemaVersion:99}),
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

it('shares cancellation only within one configured group and gives separate checks independent ownership',async()=>{
 const {root,service,probe}=await fixture();await service.configure('owner-a',config);await service.configure('owner-b',config);
 const firstCwd=path.join(root,'a'),secondCwd=path.join(root,'b');await Promise.all([service.check('owner-a',firstCwd,target),service.check('owner-b',secondCwd,target)]);
 const batch=(cwd:string)=>probe.mock.calls.filter(([check,at])=>at===cwd&&config.checks.some(row=>row.id===check.id)).map(call=>call[2]);
 const first=batch(firstCwd),second=batch(secondCwd);expect(first).toHaveLength(config.checks.length);expect(second).toHaveLength(config.checks.length);expect(new Set(first).size).toBe(2);expect(new Set(second).size).toBe(2);expect(first.every(signal=>!second.includes(signal))).toBe(true);
 for(const cwd of [firstCwd,secondCwd]){const calls=probe.mock.calls.filter(([,at])=>at===cwd);const cloud=calls.filter(([check])=>check.probe.kind==='http');expect(new Set(cloud.map(call=>call[2])).size).toBe(1);const runtime=calls.filter(([check])=>config.checks.some(row=>row.id===check.id)&&['mcp','cli'].includes(check.probe.kind));expect(new Set(runtime.map(call=>call[2])).size).toBe(1);expect(cloud[0][2]).not.toBe(runtime[0][2]);}
 for(const cwd of [firstCwd,secondCwd]){const own=batch(cwd)[0];for(const [check,at,signal] of probe.mock.calls)if(at===cwd&&['github-auth','worker-cli'].includes(check.id))expect(signal).not.toBe(own);}
 await service.close();
});
