import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';
import type { SessionCallbacks } from './agentRunner.ts';
import type { PullInfo } from '../shared/types.ts';

vi.mock('./config.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./config.ts')>();
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-lifecycle-'));
  return {...real, HOME_DIR: root, STATE_FILE: path.join(root, 'state.json'), WORKSPACE_ROOT: path.join(root, 'workspaces')};
});
import { HOME_DIR, STATE_FILE } from './config.ts';
import { Swarm } from './swarm.ts';

const offices: Swarm[] = [];
const issue = {number: 1, title: 'Build synthetic feature', body: 'Test only', url: 'https://example.test/issues/1', labels: [], assignees: []};
function backend() {
  const external = {
    demo: false, terminals: false,
    user: vi.fn(async () => 'synthetic-user'), reconnectClis: vi.fn(async () => []), hooksReady: vi.fn(),
    detectClis: vi.fn(async () => []), releaseClis: vi.fn(async () => {}),
    setLocalPath: vi.fn(), ensureClone: vi.fn(async () => {}), releaseDesk: vi.fn(async () => {}),
    listIssues: vi.fn(async () => [issue]), listPulls: vi.fn(async (): Promise<PullInfo[]> => []), syncMain: vi.fn(async () => null),
    prDetails: vi.fn(async () => ({state: 'OPEN'})),
    commentPull: vi.fn(async () => 'https://example.test/comment'), mergePull: vi.fn(async () => {}),
    prFiles: vi.fn<Backend['prFiles']>(async () => []),
    mainDir: () => HOME_DIR, deskDir: () => HOME_DIR, prepareDesk: vi.fn(async () => HOME_DIR),
    startSession: vi.fn((_opts: unknown, _cb: SessionCallbacks) => ({stop: vi.fn(), send: vi.fn()})),
    previews: {hasDefault: vi.fn(async () => false), start: vi.fn(() => {throw new Error('Unexpected preview execution');})},
    office: {head: vi.fn(async () => null), takeLastUpdate: vi.fn(async () => null), isOwnFolder: () => false},
  };
  return external;
}
async function office(withRepo = false, configure?: (fake: ReturnType<typeof backend>) => void) {
  const persisted = {version: 2, settings: {runtime: 'sdk', ceoHeartbeatMin: 0},
    repos: withRepo ? [{id: 'synthetic/repo', fullName: 'synthetic/repo', defaultBranch: 'main', floor: 1, color: '#000', description: '', url: '', autoAssign: false, autoMerge: false, browserTesting: false, addedAt: 1}] : []};
  await fs.writeFile(STATE_FILE, JSON.stringify(persisted));
  const fake = backend(); configure?.(fake); const swarm = new Swarm(fake as unknown as Backend); offices.push(swarm);
  swarm.capabilityPreflight = vi.fn(async () => null); // explicitly approved synthetic readiness
  await swarm.init(); return {swarm, fake};
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(offices.splice(0).map(swarm => swarm.shutdown().catch(() => {})));
  vi.useRealTimers();
  for (const entry of await fs.readdir(HOME_DIR)) await fs.rm(path.join(HOME_DIR, entry), {recursive: true, force: true});
});
afterAll(async () => fs.rm(HOME_DIR, {recursive: true, force: true}));

it('preserves corrupt, malformed and future state even when cleanup follows failed initialization', async () => {
  for (const raw of ['broken JSON', 'null', '[]', '{"version":3}', '{"agents":{}}', '{"settings":null}', '{"repos":[{"id":"x"}]}', '{"agents":[{"id":"x","name":"X","repoId":"","status":"idle","logTail":{}}]}', '{"repos":[{"id":"x","fullName":"x/y","defaultBranch":"main"},{"id":"x","fullName":"x/y","defaultBranch":"main"}]}']) {
    await fs.writeFile(STATE_FILE, raw); const fake = backend(); const swarm = new Swarm(fake as unknown as Backend);
    await expect(swarm.init()).rejects.toThrow('preserve and repair');
    await swarm.shutdown(); await vi.advanceTimersByTimeAsync(60000);
    expect(await fs.readFile(STATE_FILE, 'utf8')).toBe(raw);
    expect(fake.user).not.toHaveBeenCalled(); expect(fake.reconnectClis).not.toHaveBeenCalled();
    expect(fake.releaseClis).not.toHaveBeenCalled();
  }
});

it('initializes a missing file and round trips a legacy office without discarding its settings', async () => {
  await fs.rm(STATE_FILE, {force: true}); const fake = backend(); const swarm = new Swarm(fake as unknown as Backend); offices.push(swarm);
  await swarm.init(); await swarm.shutdown();
  expect(JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).version).toBe(2);
  await fs.writeFile(STATE_FILE, JSON.stringify({settings: {companyName: 'Retained company', maxConcurrent: 7}, repos: [], agents: []}));
  const restored = new Swarm(backend() as unknown as Backend); offices.push(restored); await restored.init(); await restored.shutdown();
  expect(JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).settings).toMatchObject({companyName: 'Retained company', sessionLimit: 7});
});

it('cancels startup and recurring work and performs shutdown only once', async () => {
  const {swarm, fake} = await office(true); const reads = fake.listIssues.mock.calls.length;
  const first = swarm.shutdown(true); expect(swarm.shutdown(false)).toBe(first); await first;
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(180000);
  expect(fake.listIssues).toHaveBeenCalledTimes(reads); expect(fake.startSession).not.toHaveBeenCalled();
  expect(fake.releaseClis).toHaveBeenCalledExactlyOnceWith(true);
});

it('does not start a session when preparation completes after shutdown', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let prepared!: (value: string) => void;
  fake.prepareDesk.mockImplementation(() => new Promise<string>(resolve => {prepared = resolve;}));
  await swarm.assign(agent.id, 1);
  for (let i = 0; i < 10 && !prepared; i++) await Promise.resolve();
  expect(prepared).toBeTypeOf('function'); await swarm.shutdown(true); prepared(HOME_DIR);
  await Promise.resolve(); await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((item: {id: string}) => item.id === agent.id)).toMatchObject({status: 'preparing', issueNumber: 1, task: 'issue'});
  await expect(swarm.assign(agent.id, 1)).rejects.toThrow('shutting down');
});

it('stops SDK work, ignores its closing callback and preserves a resumable checkpoint', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  const stop = vi.fn(); let callbacks!: SessionCallbacks;
  fake.startSession.mockImplementation((_opts, cb) => {callbacks = cb; return {stop, send: vi.fn()};});
  await swarm.assign(agent.id, 1);
  for (let i = 0; i < 20 && !callbacks; i++) await Promise.resolve();
  expect(callbacks).toBeDefined(); callbacks.sessionId('synthetic-resumable-session');
  stop.mockImplementation(() => callbacks.finished({ok: false, interrupted: true, errors: [], costUsd: 0, turns: 0, text: ''}));
  await swarm.shutdown(true); expect(stop).toHaveBeenCalledOnce();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((item: {id: string}) => item.id === agent.id)).toMatchObject({status: 'working', sessionId: 'synthetic-resumable-session', task: 'issue'});
  callbacks.log([{kind: 'text', text: 'late log'}]); callbacks.sessionId('late changed session'); callbacks.screenshot(Buffer.from('late'), 'image/png');
  await vi.advanceTimersByTimeAsync(60000);
  expect(vi.getTimerCount()).toBe(0); expect(await fs.readFile(STATE_FILE, 'utf8')).toBe(JSON.stringify(saved, null, 2));
});

it('does not prepare a desk when readiness resolves after shutdown', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let ready!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {ready = resolve;});
  await swarm.assign(agent.id, 1); await swarm.shutdown(true); ready(null);
  await Promise.resolve(); await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
});

it('continues process cleanup when persistence fails and reports the failure', async () => {
  const {swarm, fake} = await office();
  await fs.rm(STATE_FILE); await fs.mkdir(STATE_FILE);
  vi.useRealTimers(); // atomicWrite's bounded Windows rename retries use real time
  await expect(swarm.shutdown()).rejects.toThrow('did not complete cleanly');
  expect(fake.releaseClis).toHaveBeenCalledExactlyOnceWith(false);
});

it('requeues interrupted QA and clears an issue lacking a resumable checkpoint on restart', async () => {
  const {swarm} = await office(true); const developer = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  const qa = saved.agents.find((item: {role: string}) => item.role === 'qa');
  Object.assign(qa, {status: 'working', task: 'qa', prNumber: 4, issueNumber: 1});
  Object.assign(saved.agents.find((item: {id: string}) => item.id === developer.id), {status: 'preparing', task: 'issue', issueNumber: 1});
  saved.qa = [{id: 'qa-checkpoint', repoId: 'synthetic/repo', qaAgentId: qa.id, devAgentId: developer.id, status: 'testing', prNumber: 4}];
  await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  const fake = backend(); const restored = new Swarm(fake as unknown as Backend); offices.push(restored); await restored.init(); await restored.shutdown();
  const recovered = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(recovered.qa[0].status).toBe('queued');
  expect(recovered.agents.find((item: {id: string}) => item.id === developer.id)).toMatchObject({status: 'idle', task: null, issueNumber: null});
  expect(fake.startSession).not.toHaveBeenCalled();
});

it('closes preview admission immediately when shutdown begins', async () => {
  const {swarm, fake} = await office(true);
  let resolve!: (value: {state: string}) => void;
  fake.prDetails.mockImplementation(() => new Promise(done => {resolve = done;}));
  const pending = swarm.startPreview('synthetic/repo', 1);
  const stopped = swarm.shutdown(true); resolve({state: 'OPEN'});
  await expect(pending).rejects.toThrow('closed'); await stopped;
  expect(fake.previews.start).not.toHaveBeenCalled();
});

const pull: PullInfo = {number: 7, title: 'Synthetic PR', url: 'https://example.test/pr/7', headRefName: 'swarm/issue-1-synthetic', headSha: 'tested-head', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', checks: 'passing', failedChecks: [], pendingChecks: [], closesIssues: [], createdAt: '', mergedAt: null, additions: 1, deletions: 0, reviewDecision: null};
const qaReport = {verdict: 'pass', summary: 'Synthetic acceptance verified.', checks: [{name: 'API response', result: 'pass', details: 'Observed the expected response.'}], commands: [], screenshots: []};
async function qaOffice(head = pull.headSha) {
  const fixture = await office(true, fake => {
    fake.listPulls.mockResolvedValue([pull]);
    const details = {...pull, headSha: head, body: 'Synthetic requirements', isCrossRepository: false};
    fake.prDetails.mockResolvedValue(details);
  });
  await fixture.swarm.sendToQa('synthetic/repo', 7); await vi.advanceTimersByTimeAsync(200);
  expect(fixture.fake.startSession).toHaveBeenCalledOnce();
  return {...fixture, callbacks: fixture.fake.startSession.mock.calls[0][1]};
}
async function finishQa(swarm: Swarm, callbacks: SessionCallbacks, report: unknown) {
  callbacks.finished({ok: true, structured: report, text: '', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 50 && swarm.snapshot().qa[0].status === 'testing'; i++) await Promise.resolve();
  for (let i = 0; i < 10; i++) await Promise.resolve(); // settle the completion-triggered repo refresh
}

it.each([
  {...qaReport, checks: [{name: 'API', result: 'unknown', details: 'Never verified'}]},
  {...qaReport, screenshots: ['Claimed screenshot without captured evidence']},
  {...qaReport, checks: []},
])('does not approve malformed or unobserved QA evidence through the actual scheduler %#', async report => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, report);
  expect(swarm.snapshot().qa[0].status).toBe('queued'); expect(fake.commentPull).not.toHaveBeenCalled();
  await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'queued', passedSha: null, sessionFailures: 1});
});

it('accepts complete QA evidence at its tested head and revokes it immediately when retesting is requested', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  expect(swarm.snapshot().qa[0].status).toBe('passed'); expect(fake.commentPull).toHaveBeenCalledOnce();
  await swarm.sendToQa('synthetic/repo', 7); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'queued', passedSha: null, testedSha: null});
});

it('does not grant QA approval when posting evidence completes after shutdown', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); let posted!: (value: string) => void;
  fake.commentPull.mockImplementation(() => new Promise(resolve => {posted = resolve;}));
  callbacks.finished({ok: true, structured: qaReport, text: '', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 30 && !posted; i++) await Promise.resolve();
  expect(posted).toBeTypeOf('function'); await swarm.shutdown(true); posted('https://example.test/comment');
  await Promise.resolve(); await Promise.resolve();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'testing', passedSha: null});
  expect(saved.agents.find((agent: {role: string}) => agent.role === 'qa').status).toBe('working');
});

it('merges only the actual commit approved by QA through the real merge loop', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.mergePull.mockImplementation(async () => {fake.listPulls.mockResolvedValue([{...pull, state: 'MERGED', mergedAt: '2026-10-13T00:00:00Z'}]);});
  swarm.updateRepo('synthetic/repo', {autoMerge: true}); await swarm.syncRepo('synthetic/repo');
  for (let i = 0; i < 40 && !fake.mergePull.mock.calls.length; i++) await Promise.resolve();
  expect(fake.prFiles).toHaveBeenCalledWith('synthetic/repo', 7, 'tested-head');
  expect(fake.mergePull.mock.calls).toEqual([['synthetic/repo', 7, 'squash', 'tested-head']]);
});

it('never applies cached checks and scans to a different head returned by PR details', async () => {
  const {swarm, fake, callbacks} = await qaOffice('new-tested-head'); await finishQa(swarm, callbacks, qaReport);
  fake.listPulls.mockResolvedValue([{...pull, mergeable: 'UNKNOWN', mergeState: 'UNKNOWN'}]);
  swarm.updateRepo('synthetic/repo', {autoMerge: true}); await swarm.syncRepo('synthetic/repo');
  for (let i = 0; i < 40 && swarm.snapshot().qa[0].status === 'passed'; i++) await Promise.resolve();
  expect(swarm.snapshot().qa[0].status).toBe('queued'); expect(fake.mergePull).not.toHaveBeenCalled();
  await swarm.shutdown(); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({passedSha: null, testedSha: null});
});

it.each(['retest', 'shutdown'])('does not merge when %s happens during the scan', async action => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  let scanned!: (files: {file: string; content: string}[]) => void;
  fake.prFiles.mockImplementation(() => new Promise(resolve => {scanned = resolve;}));
  swarm.updateRepo('synthetic/repo', {autoMerge: true}); await swarm.syncRepo('synthetic/repo');
  for (let i = 0; i < 40 && !scanned; i++) await Promise.resolve();
  expect(scanned).toBeTypeOf('function');
  if (action === 'shutdown') await swarm.shutdown(); else await swarm.sendToQa('synthetic/repo', 7);
  scanned([]); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.mergePull).not.toHaveBeenCalled();
});

it('requires commit-bound QA for the manager merge action and validates its method', async () => {
  const {swarm, fake} = await office(true, fake => fake.listPulls.mockResolvedValue([pull]));
  await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow('commit-bound QA');
  await expect(swarm.mergePull('synthetic/repo', 7, 'bad' as 'squash')).rejects.toThrow('Invalid merge method');
  expect(fake.mergePull).not.toHaveBeenCalled();
});

it('pins the approved commit and selected method for a verified manager merge', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.mergePull.mockImplementation(async () => {fake.listPulls.mockResolvedValue([{...pull, state: 'MERGED', mergedAt: '2026-10-13T00:00:00Z'}]);});
  await swarm.mergePull('synthetic/repo', 7, 'rebase');
  expect(fake.mergePull.mock.calls).toEqual([['synthetic/repo', 7, 'rebase', 'tested-head']]);
});

it.each([
  {name: 'stale QA head', patch: {headSha: 'changed-head'}},
  {name: 'pending checks', patch: {checks: 'pending' as const}},
  {name: 'blocked branch', patch: {mergeState: 'BLOCKED'}},
  {name: 'behind branch', patch: {mergeState: 'BEHIND'}},
])('blocks manager merging on $name', async ({patch}) => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.listPulls.mockResolvedValue([{...pull, ...patch}]);
  await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow();
  expect(fake.mergePull).not.toHaveBeenCalled(); expect(fake.startSession).toHaveBeenCalledOnce();
});

it('blocks manager merging on a local scan finding and unavailable scan evidence', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.prFiles.mockResolvedValue([{file: 'flow.json', content: '{"connection":"shared_dropbox"}'}]);
  await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow('Merge blocked (dlp)');
  fake.prFiles.mockRejectedValue(new Error('Synthetic scan unavailable'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow('DLP scan unavailable');} finally {warn.mockRestore();}
  expect(fake.mergePull).not.toHaveBeenCalled();
});

it.each(['unconfigured', 'empty'])('denies execution when readiness is %s', async mode => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  swarm.capabilityPreflight = mode === 'empty' ? async () => '' : new Swarm(fake as unknown as Backend).capabilityPreflight;
  await swarm.assign(agent.id, 1); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error'});
});

it('checks the effective SDK runtime when terminal execution is unavailable', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  swarm.updateSettings({runtime: 'terminal', defaultCli: 'copilot'});
  const preflight = vi.fn(async () => 'Synthetic node runtime unavailable'); swarm.capabilityPreflight = preflight;
  await swarm.assign(agent.id, 1); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'node'); expect(fake.startSession).not.toHaveBeenCalled();
});

it('does not prepare a workspace when an assignment is stopped during its readiness check', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  await swarm.assign(agent.id, 1); swarm.stopAgent(agent.id); checked(null);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
});

it('blocks new prompts to a working session when readiness expires without sending the prompt', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value;
  swarm.capabilityPreflight = vi.fn(async () => 'Synthetic authentication expired');
  await expect(swarm.message(agent.id, 'Continue the feature')).rejects.toThrow('authentication expired');
  expect(handle.send).not.toHaveBeenCalled(); expect(fake.startSession).toHaveBeenCalledOnce();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.status).toBe('working');
});

it('does not send a checked follow-up after shutdown changes its session', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value; let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.message(agent.id, 'Continue the feature'); await swarm.shutdown(true); checked(null);
  await expect(pending).rejects.toThrow('Session changed'); expect(handle.send).not.toHaveBeenCalled();
});

it('reserves a release reviewer while checking and requires readiness before starting', async () => {
  const {swarm, fake} = await office(true); const qa = swarm.snapshot().agents.find(a => a.role === 'qa')!;
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;}));
  const pending = swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release');
  await expect(swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'another-release')).rejects.toThrow('busy');
  expect(fake.startSession).not.toHaveBeenCalled(); checked(null);
  await expect(pending).resolves.toContain('started'); expect(fake.startSession).toHaveBeenCalledOnce();
});

it('does not start release QA on blocked readiness or after the reviewer is stopped', async () => {
  const {swarm, fake} = await office(true); const qa = swarm.snapshot().agents.find(a => a.role === 'qa')!;
  swarm.capabilityPreflight = async () => 'Synthetic environment unavailable';
  await expect(swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release')).rejects.toThrow('environment unavailable');
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release'); swarm.stopAgent(qa.id); checked(null);
  await expect(pending).rejects.toThrow('Reviewer stopped'); expect(fake.startSession).not.toHaveBeenCalled();
});

it('checks the owning CLI before restart recovery resumes a saved session', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  fake.startSession.mock.calls[0][1].sessionId('synthetic-session'); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  saved.settings.runtime = 'terminal'; saved.settings.defaultCli = 'copilot';
  saved.agents.find((a: {id: string}) => a.id === agent.id).sessionCli = 'codex';
  await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  const restoredBackend = backend(); restoredBackend.terminals = true;
  const restored = new Swarm(restoredBackend as unknown as Backend); offices.push(restored);
  const preflight = vi.fn(async () => 'Synthetic Codex readiness unavailable'); restored.capabilityPreflight = preflight;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {await restored.init(); for (let i = 0; i < 30; i++) await Promise.resolve();} finally {warn.mockRestore();}
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(restoredBackend.startSession).not.toHaveBeenCalled();
  expect(restored.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error'});
  await restored.shutdown();
  const recovered = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(recovered.agents.find((a: {id: string}) => a.id === agent.id).sessionId).toBe('synthetic-session');
});
