import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';
import type { SessionCallbacks } from './agentRunner.ts';
import type { SessionOptions } from './agentRunner.ts';
import type { PullInfo } from '../shared/types.ts';
import {CEO_ID} from '../shared/types.ts';

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
    user: vi.fn(async () => 'synthetic-user'), reconnectClis: vi.fn<Backend['reconnectClis']>(async () => []), hooksReady: vi.fn(),
    detectClis: vi.fn(async () => []), releaseClis: vi.fn(async () => {}),
    setLocalPath: vi.fn(), ensureClone: vi.fn(async () => {}), releaseDesk: vi.fn(async () => {}), removeDesk: vi.fn(async () => {}),
    listIssues: vi.fn(async () => [issue]), listPulls: vi.fn(async (): Promise<PullInfo[]> => []), syncMain: vi.fn(async () => null),
    prDetails: vi.fn(async () => ({state: 'OPEN'})),
    commentPull: vi.fn(async () => 'https://example.test/comment'), mergePull: vi.fn(async () => {}),
    prFiles: vi.fn<Backend['prFiles']>(async () => []),
    prForBranch: vi.fn<Backend['prForBranch']>(async () => null),
    uploadEvidence: vi.fn<Backend['uploadEvidence']>(async () => 'https://example.test/evidence'),
    mainDir: () => HOME_DIR, deskDir: () => HOME_DIR, prepareDesk: vi.fn<Backend['prepareDesk']>(async () => HOME_DIR),
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
  vi.useRealTimers(); // allow real terminal-emulator flushes during cleanup
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
  for (let i = 0; i < 60 && !prepared; i++) await Promise.resolve();
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

it.each(['runtime', 'model', 'agent', 'project', 'pause', 'policy'])('rejects changed %s context while capability admission is pending', async change => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  await swarm.assign(agent.id, 1);
  if (change === 'runtime') swarm.updateSettings({runtime: 'terminal', defaultCli: 'codex'});
  if (change === 'model') swarm.updateSettings({defaultModel: 'changed-synthetic-model'});
  if (change === 'agent') swarm.updateAgent(agent.id, {cli: 'codex'});
  if (change === 'project') swarm.updateRepo('synthetic/repo', {mission: 'New synthetic scope'});
  if (change === 'pause') swarm.taskPaused = () => true;
  if (change === 'policy') swarm.workerAdmissionContext = () => 'updated-synthetic-policy';
  checked(null); for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.lastError).toContain('Execution context changed');
});

it('denies an unavailable configuration snapshot without issuing probes or leaving a task preparing', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  const preflight = vi.fn(async () => null); swarm.capabilityPreflight = preflight;
  swarm.workerAdmissionContext = () => {throw new Error('Synthetic configuration unavailable');};
  await swarm.assign(agent.id, 1); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(preflight).not.toHaveBeenCalled(); expect(fake.prepareDesk).not.toHaveBeenCalled();
  expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error', lastError: expect.stringContaining('context is unavailable')});
});

it('does not launch unchecked settings changed during worktree preparation and can retry with fresh admission', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let prepared!: (value: string) => void;
  fake.prepareDesk.mockImplementationOnce(() => new Promise(resolve => {prepared = resolve;}));
  const preflight = vi.fn(async () => null); swarm.capabilityPreflight = preflight;
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60 && !prepared; i++) await Promise.resolve();
  expect(prepared).toBeTypeOf('function'); swarm.updateAgent(agent.id, {model: 'claude-synthetic-model'}); prepared(HOME_DIR);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error', lastError: expect.stringContaining('Execution context changed')});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  expect(preflight).toHaveBeenCalledTimes(2); expect(fake.startSession).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({model: 'claude-synthetic-model'});
});

it('checks linked repositories and denies a blocked reference before preparing the workspace', async () => {
  const {swarm, fake} = await office(true);
  const state = (swarm as unknown as {state: {repos: Array<{id: string; fullName: string; links: string[]}>}}).state;
  const linked = {...state.repos[0], id: 'synthetic/reference', fullName: 'synthetic/reference', links: []}; state.repos.push(linked);
  const runtime = (swarm as unknown as {repoRt: Map<string, unknown>}).repoRt;
  runtime.set(linked.id, {...runtime.get('synthetic/repo') as Record<string, unknown>});
  swarm.updateRepo('synthetic/repo', {links: [linked.id]});
  const preflight = vi.fn(async (id: string) => id === linked.id ? 'Reference authentication expired' : null); swarm.capabilityPreflight = preflight;
  const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60; i++) await Promise.resolve();
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'node'); expect(preflight).toHaveBeenCalledWith(linked.id, 'node');
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.lastError).toContain(`${linked.id}: Reference authentication expired`);
});

it('does not send a live follow-up if its checked project scope changes', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value;
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.message(agent.id, 'Continue with the synthetic feature');
  const rejected = expect(pending).rejects.toThrow('Execution context changed');
  for (let i = 0; i < 20 && !checked; i++) await Promise.resolve();
  expect(checked).toBeTypeOf('function');
  swarm.updateRepo('synthetic/repo', {mission: 'Changed project scope'}); checked(null);
  await rejected; expect(handle.send).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.status).toBe('working');
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

it('keeps tool authority through a legitimate checkpoint update and revokes it on configuration change and cancellation', async () => {
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const opts=fake.startSession.mock.calls[0][0] as SessionOptions;
  const callbacks=fake.startSession.mock.calls[0][1];
  expect(await opts.authorizeTool?.()).toBeNull();callbacks.sessionId('synthetic-runtime-checkpoint');
  expect(await opts.authorizeTool?.()).toBeNull();
  swarm.updateAgent(agent.id,{model:'claude-changed'});expect(await opts.authorizeTool?.()).toContain('configuration changed');
  swarm.stopAgent(agent.id);expect(await opts.authorizeTool?.()).toContain('no longer owns');
});

it('revokes worker authority on completion before a replacement is dispatched', async () => {
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const opts=fake.startSession.mock.calls[0][0] as SessionOptions;
  fake.startSession.mock.calls[0][1].finished({ok:false,text:'synthetic',costUsd:0,turns:1,errors:['synthetic failure']});
  expect(await opts.authorizeTool?.()).toContain('no longer owns');
});

it('rechecks running worker prerequisites, shares concurrent refreshes and recovers after a transient blocker',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;
  const preflight=vi.fn(()=>new Promise<string|null>(resolve=>{checked=resolve;}));swarm.capabilityPreflight=preflight;
  const first=authorize();const second=authorize();
  for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  expect(preflight).toHaveBeenCalledExactlyOnceWith('synthetic/repo','node');checked('Synthetic authentication expired');
  expect(await first).toContain('authentication expired');expect(await second).toContain('authentication expired');
  swarm.capabilityPreflight=vi.fn(async()=>null);expect(await authorize()).toBeNull();
  expect(fake.startSession).toHaveBeenCalledOnce();
});

it.each(['stop','fire'])('cancels a pending tool refresh immediately on worker %s and cannot grant from a late reply',async action=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  expect(checked).toBeTypeOf('function');if(action==='stop')swarm.stopAgent(agent.id);else swarm.fireAgent(agent.id);
  expect(await pending).toContain('no longer owns');checked(null);
  expect(await authorize()).toContain('no longer owns');
});

it('denies changed worker configuration while a tool refresh is pending',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  swarm.updateAgent(agent.id,{model:'claude-changed'});checked(null);
  expect(await pending).toContain('configuration changed');
});

it('bounds a stalled worker tool refresh and ignores its late successful response',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  await vi.advanceTimersByTimeAsync(90001);expect(await pending).toContain('expired after 90 seconds');
  checked(null);swarm.capabilityPreflight=async()=>null;expect(await authorize()).toBeNull();
});

it('does not send a checked follow-up after shutdown changes its session', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value; let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.message(agent.id, 'Continue the feature'); const rejected = expect(pending).rejects.toThrow('Session changed');
  await Promise.resolve(); await swarm.shutdown(true); checked(null);
  await rejected; expect(handle.send).not.toHaveBeenCalled();
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
  const pending = swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release'); const rejected = expect(pending).rejects.toThrow('Reviewer stopped');
  await Promise.resolve(); swarm.stopAgent(qa.id); checked(null);
  await rejected; expect(fake.startSession).not.toHaveBeenCalled();
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

it('persists session ID and CLI together when a developer hands its PR to QA', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const callbacks = fake.startSession.mock.calls[0][1]; callbacks.sessionId('original-sdk-session');
  callbacks.finished({ok: true, text: 'https://github.com/synthetic/repo/pull/7', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 30; i++) await Promise.resolve(); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({devAgentId: agent.id, devSessionId: 'original-sdk-session', devSessionCli: 'claude'});
});

async function repairOffice(checkpointCli: string | null, terminal: boolean, blocked: boolean) {
  const {swarm} = await office(true); const developer = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'}); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  saved.settings.runtime = terminal ? 'terminal' : 'sdk'; saved.settings.defaultCli = 'copilot';
  Object.assign(saved.agents.find((a: {id: string}) => a.id === developer.id), {status: 'done', task: 'issue', prNumber: 7, sessionId: 'newer-unrelated-session', sessionCli: 'copilot'});
  saved.qa = [{repoId: 'synthetic/repo', prNumber: 7, status: 'failed', round: 1, devAgentId: developer.id, qaAgentId: null, summary: 'Synthetic failure', checks: [{name: 'Acceptance', result: 'fail', details: 'Synthetic incorrect response'}], issueNumber: 1, devSessionId: 'original-repair-session', devSessionCli: checkpointCli, fixInstructions: 'Fix the synthetic response', sessionFailures: 0, fixReason: 'qa', mergeFixes: 0, retests: 0}];
  await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  const fake = backend(); fake.terminals = terminal; fake.listPulls.mockResolvedValue([pull]);
  const restored = new Swarm(fake as unknown as Backend); offices.push(restored);
  const preflight = vi.fn(async () => blocked ? 'Synthetic runtime blocked' : null); restored.capabilityPreflight = preflight;
  await restored.init(); await vi.advanceTimersByTimeAsync(1000);
  return {swarm: restored, fake, preflight, developer};
}

it('uses the repair checkpoint CLI even when the developer has a newer unrelated session', async () => {
  const {swarm, fake, preflight, developer} = await repairOffice('codex', true, true);
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).not.toHaveBeenCalled();
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((a: {id: string}) => a.id === developer.id)).toMatchObject({sessionId: 'original-repair-session', sessionCli: 'codex'});
  expect(saved.qa[0]).toMatchObject({devSessionId: 'original-repair-session', devSessionCli: 'codex'});
});

it.each([null, 'unknown-runtime'])('never guesses a CLI for legacy repair checkpoint %s', async cli => {
  const {swarm, fake, preflight} = await repairOffice(cli, true, true);
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'copilot'); expect(fake.startSession).not.toHaveBeenCalled();
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({devSessionId: null, devSessionCli: null});
});

it.each(['claude', 'codex'])('dispatches the compatible %s repair and stores the new checkpoint pair on completion', async cli => {
  const terminal = cli === 'codex'; const {swarm, fake} = await repairOffice(cli, terminal, false);
  expect(fake.startSession).toHaveBeenCalledOnce();
  const options = fake.startSession.mock.calls[0][0] as {cli?: string; resumeSessionId?: string};
  expect(options.resumeSessionId).toBe('original-repair-session'); expect(options.cli ?? 'claude').toBe(cli);
  const callbacks = fake.startSession.mock.calls[0][1]; callbacks.sessionId('completed-repair-session');
  callbacks.finished({ok: true, text: 'Synthetic repair completed', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 30; i++) await Promise.resolve();
  vi.useRealTimers(); // xterm's asynchronous flush during terminal persistence must run
  await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'queued', devSessionId: 'completed-repair-session', devSessionCli: cli});
});

it('starts fresh rather than giving a Codex checkpoint to the SDK', async () => {
  const {swarm, fake, preflight} = await repairOffice('codex', false, false);
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'node'); expect(fake.startSession).toHaveBeenCalledOnce();
  expect((fake.startSession.mock.calls[0][0] as {resumeSessionId?: string}).resumeSessionId).toBeUndefined();
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({devSessionId: null, devSessionCli: null});
});

it('blocks CEO work without native terminal readiness and retains the queued job', async () => {
  const {swarm, fake} = await office(); const preflight = vi.fn(async () => null); swarm.ceoPreflight = preflight;
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().ceo).toMatchObject({job: null, blockedReason: expect.stringContaining('terminal runtime'), queue: [{kind: 'chat'}]});
  expect(swarm.snapshot().ceo.retryAt).toBeGreaterThan(Date.now());
});

it('binds CEO tool authority to its active job and revokes it when stopped', async () => {
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});
  swarm.ceoPreflight=async()=>null;
  swarm.messageCeo('Synthetic company review');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const opts=fake.startSession.mock.calls[0][0] as SessionOptions;
  expect(await opts.authorizeTool?.()).toBeNull();swarm.stopAgent(CEO_ID);
  expect(await opts.authorizeTool?.()).toContain('no longer owns');
  const result=await opts.office!.call('company_status',{});
  expect(result).toContain('no longer owns');
});

it('rechecks running CEO prerequisites and cancels pending refresh when its job stops',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.messageCeo('Synthetic CEO readiness');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  swarm.ceoPreflight=async()=> 'Synthetic Copilot prerequisites unavailable';
  expect(await authorize()).toContain('prerequisites unavailable');
  let checked!:(value:string|null)=>void;swarm.ceoPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  swarm.stopAgent(CEO_ID);expect(await pending).toContain('no longer owns');checked(null);
});

it.each(['missing', 'empty', 'blocked'])('blocks %s CEO readiness without dropping the job or spamming retries', async mode => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;});
  if (mode !== 'missing') swarm.ceoPreflight = vi.fn(async () => mode === 'empty' ? '' : 'Synthetic project access unavailable');
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  const messages = swarm.snapshot().messages.length;
  await vi.advanceTimersByTimeAsync(16000);
  expect(fake.startSession).not.toHaveBeenCalled(); expect(swarm.snapshot().ceo.queue).toHaveLength(1);
  expect(swarm.snapshot().messages).toHaveLength(messages);
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.ceo).toMatchObject({job: null, blockedReason: expect.any(String), retryAt: expect.any(Number)});
  expect(saved.ceo.queue[0].text).toBe('Synthetic company question');
});

it('reserves the CEO during checks and starts a ready job using the fixed Copilot runtime', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); swarm.ceoPreflight = preflight;
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  expect(swarm.snapshot().agents.find(a => a.id === CEO_ID)?.status).toBe('preparing');
  expect(preflight).toHaveBeenCalledExactlyOnceWith(['synthetic/repo']); expect(fake.startSession).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000); expect(preflight).toHaveBeenCalledOnce(); checked(null);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({role: 'ceo', cli: 'copilot', additionalDirectories: [HOME_DIR]});
  expect(swarm.snapshot().ceo.blockedReason).toBeNull();
  const callbacks = fake.startSession.mock.calls[0][1]; callbacks.turn?.('Synthetic answer');
  callbacks.finished({ok: true, text: 'Synthetic answer', costUsd: 0, turns: 1, errors: []});
  expect(swarm.snapshot().ceo.job).toBeNull();
});

it('retains startup failures and retries immediately when fresh operator information arrives', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); swarm.ceoPreflight = async () => null;
  fake.startSession.mockImplementationOnce(() => {throw new Error('Synthetic CLI start failed');});
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(swarm.snapshot().ceo.blockedReason).toContain('could not start'));
  expect(swarm.snapshot().ceo.queue).toHaveLength(1);
  swarm.messageCeo('Additional synthetic context'); await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(swarm.snapshot().ceo.blockedReason).toBeNull();
});

it('cannot start an older cancelled CEO preflight while its replacement is preparing', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); const checks: ((value: string | null) => void)[] = [];
  swarm.ceoPreflight = () => new Promise(resolve => {checks.push(resolve);});
  swarm.messageCeo('Old synthetic request'); await vi.advanceTimersByTimeAsync(150); swarm.stopAgent(CEO_ID);
  swarm.messageCeo('New synthetic request'); await vi.advanceTimersByTimeAsync(150);
  expect(checks).toHaveLength(2); checks[0](null); for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled(); checks[1](null);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect((fake.startSession.mock.calls[0][0] as {prompt: string}).prompt).toContain('New synthetic request');
  expect((fake.startSession.mock.calls[0][0] as {prompt: string}).prompt).not.toContain('Old synthetic request');
});

it('ignores every cancelled CEO callback while a replacement job owns the terminal', async () => {
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.messageCeo('Old synthetic CEO request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const old=fake.startSession.mock.calls[0][1];const oldHandle=fake.startSession.mock.results[0].value;
  swarm.stopAgent(CEO_ID);expect(oldHandle.stop).toHaveBeenCalledOnce();
  expect(swarm.snapshot().ceo.job).toBeNull();
  swarm.messageCeo('Replacement synthetic CEO request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  const before=swarm.snapshot();
  old.log([{kind:'error',text:'Obsolete CEO log'}]);old.tool('obsolete-tool');old.sessionId('obsolete-checkpoint');
  old.turn?.('Obsolete phone reply');old.limited?.(Date.now()+60000);old.usageWarning?.({rateLimitType:'five_hour',resetsAt:Date.now()+60000,utilization:.99});
  old.finished({ok:false,text:'obsolete',costUsd:90,turns:90,errors:['Obsolete error']});
  expect(swarm.snapshot()).toEqual(before);
  const current=fake.startSession.mock.calls[1][1];current.sessionId('replacement-checkpoint');current.tool('replacement-tool');
  current.turn?.('Replacement phone reply');current.finished({ok:true,text:'replacement',costUsd:2,turns:3,errors:[]});
  const after=swarm.snapshot();expect(after.ceo.job).toBeNull();
  expect(after.agents.find(a=>a.id===CEO_ID)).toMatchObject({status:'done',costUsd:2,turns:3});
  expect(after.messages.some(message=>message.text==='Replacement phone reply')).toBe(true);
  vi.useRealTimers();await swarm.shutdown(true);
  const saved=JSON.parse(await fs.readFile(STATE_FILE,'utf8'));
  expect(saved.agents.find((a:{id:string})=>a.id===CEO_ID).sessionId).toBe('replacement-checkpoint');
});

it('ignores callbacks from a failed CEO launch when the same retained job object is retried',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  let failed!:SessionCallbacks;
  fake.startSession.mockImplementationOnce((_options,callbacks)=>{failed=callbacks;throw new Error('Synthetic launch failure');});
  swarm.messageCeo('Retry this synthetic CEO job');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(swarm.snapshot().ceo.blockedReason).toContain('could not start'));
  const state=(swarm as unknown as {state:{ceo:{queue:unknown[];job:unknown}}}).state;
  const retained=state.ceo.queue[0];
  await vi.advanceTimersByTimeAsync(65000);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(state.ceo.job).toBe(retained);
  const before=swarm.snapshot();failed.turn?.('Obsolete failed reply');failed.sessionId('obsolete-failed-checkpoint');
  failed.finished({ok:true,text:'obsolete',costUsd:10,turns:10,errors:[]});
  expect(swarm.snapshot()).toEqual(before);
});

it('handles synchronous CEO completion once without leaving a stale session handle',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  const staleHandle={stop:vi.fn(),send:vi.fn()};
  fake.startSession.mockImplementationOnce((_options,callbacks)=>{
    const result={ok:true,text:'synchronous synthetic reply',costUsd:1,turns:2,errors:[]};
    callbacks.finished(result);callbacks.finished(result);callbacks.turn?.('Obsolete post-completion reply');
    return staleHandle;
  });
  swarm.messageCeo('First synthetic request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  expect(swarm.snapshot().agents.find(a=>a.id===CEO_ID)).toMatchObject({status:'done',costUsd:1,turns:2});
  expect(swarm.snapshot().ceo.job).toBeNull();
  swarm.messageCeo('Second synthetic request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(staleHandle.send).not.toHaveBeenCalled();expect(staleHandle.stop).not.toHaveBeenCalled();
});

it('blocks CEO dispatch if project requirements change during readiness verification', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  swarm.ceoPreflight = () => new Promise(resolve => {checked = resolve;});
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  swarm.updateRepo('synthetic/repo', {mission: 'Changed synthetic requirements'}); checked(null);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(swarm.snapshot().ceo.blockedReason).toContain('scope changed');
});

it('preserves a pending CEO job on shutdown without launching after its check completes', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  swarm.ceoPreflight = () => new Promise(resolve => {checked = resolve;});
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150); await swarm.shutdown(true); checked(null);
  for (let i = 0; i < 20; i++) await Promise.resolve(); expect(fake.startSession).not.toHaveBeenCalled();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); expect(saved.ceo.job.text).toBe('Synthetic company question');
});

it('expires stalled CEO readiness and ignores its eventual result', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); swarm.ceoPreflight = preflight;
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(90150);
  expect(swarm.snapshot().ceo.blockedReason).toContain('expired after 90 seconds');
  expect(swarm.snapshot().ceo.queue).toHaveLength(1); expect(preflight).toHaveBeenCalledOnce();
  checked(null); for (let i = 0; i < 20; i++) await Promise.resolve(); expect(fake.startSession).not.toHaveBeenCalled();
});

async function retainedOffice(preflight: Swarm['capabilityPreflight'], cli = 'codex', resumeId: string | null = 'keeper-owned-session') {
  const {swarm, fake} = await office(true); const developer = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(developer.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  fake.startSession.mock.calls[0][1].sessionId('older-persisted-session'); await swarm.shutdown(true);
  const restoredBackend = backend(); restoredBackend.terminals = true; const releaseIdle = vi.fn();
  restoredBackend.reconnectClis.mockImplementation(async terminalFor => {
    const terminal = terminalFor(developer.id)!; terminal.releaseIdle = releaseIdle;
    return [{agentId: developer.id, cli: cli as 'codex', resumeId, busy: true}];
  });
  const restored = new Swarm(restoredBackend as unknown as Backend); offices.push(restored); restored.capabilityPreflight = preflight;
  return {swarm: restored, fake: restoredBackend, releaseIdle, developer};
}

it('reattaches a verified retained CLI using keeper ownership despite an SDK default', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle, developer} = await retainedOffice(preflight);
  await swarm.init();
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({cli: 'codex', reattach: true, resumeSessionId: 'keeper-owned-session', terminal: expect.anything()});
  expect(releaseIdle).not.toHaveBeenCalled(); expect(fake.hooksReady).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.invocationCallOrder[0]).toBeLessThan(fake.hooksReady.mock.invocationCallOrder[0]);
  vi.useRealTimers(); // flush the real emulator while persisting the adopted terminal
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((a: {id: string}) => a.id === developer.id)).toMatchObject({sessionId: 'keeper-owned-session', sessionCli: 'codex'});
});

it('quarantines blocked retained work before releasing waiting hooks', async () => {
  const {swarm, fake, releaseIdle, developer} = await retainedOffice(async () => 'Synthetic target access expired'); await swarm.init();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
  expect(releaseIdle.mock.invocationCallOrder[0]).toBeLessThan(fake.hooksReady.mock.invocationCallOrder[0]);
  expect(swarm.snapshot().agents.find(a => a.id === developer.id)).toMatchObject({status: 'error', lastError: 'Synthetic target access expired'});
});

it('quarantines a retained paused task without starting a new session', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle, developer} = await retainedOffice(preflight);
  swarm.taskPaused = () => true; await swarm.init();
  expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
  expect(swarm.snapshot().agents.find(a => a.id === developer.id)?.status).toBe('stopped');
});

it('rechecks a pause applied during retained-session readiness', async () => {
  let paused = false; let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); const {swarm, fake, releaseIdle} = await retainedOffice(preflight);
  swarm.taskPaused = () => paused; const pending = swarm.init(); await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  paused = true; checked(null); await pending;
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
});

it('quarantines invalid retained CLI metadata without querying readiness', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle} = await retainedOffice(preflight, 'unknown-runtime'); await swarm.init();
  expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
});

it('times out retained admission, quarantines the process and ignores late readiness', async () => {
  let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); const {swarm, fake, releaseIdle} = await retainedOffice(preflight);
  const pending = swarm.init(); await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(90000); await pending; checked(null); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce(); expect(fake.hooksReady).toHaveBeenCalledOnce();
});

it('does not reopen hooks or reattach after shutdown interrupts retained admission', async () => {
  let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); const {swarm, fake} = await retainedOffice(preflight);
  const pending = swarm.init(); await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  vi.useRealTimers(); await swarm.shutdown(true); checked(null); await pending;
  expect(fake.startSession).not.toHaveBeenCalled(); expect(fake.hooksReady).not.toHaveBeenCalled();
});

it.each(['qa', 'fix'])('removes stale %s pipeline activity when retained work is quarantined', async task => {
  const {swarm, fake, developer} = await retainedOffice(async () => 'Synthetic access expired');
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  Object.assign(saved.agents.find((a: {id: string}) => a.id === developer.id), {task, prNumber: 7});
  saved.qa = [{repoId: 'synthetic/repo', prNumber: 7, status: task === 'qa' ? 'testing' : 'fixing', qaAgentId: developer.id, devAgentId: developer.id, testedSha: 'old-head', passedSha: 'old-head'}];
  await fs.writeFile(STATE_FILE, JSON.stringify(saved)); await swarm.init();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(swarm.snapshot().qa[0].status).toBe(task === 'qa' ? 'queued' : 'failed');
  if (task === 'qa') {vi.useRealTimers(); await swarm.shutdown(true); const recovered = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); expect(recovered.qa[0]).toMatchObject({testedSha: null, passedSha: null, qaAgentId: null});}
});

const secondIssue = {...issue, number: 2, title: 'Build replacement feature'};
async function twoIssueOffice() {return office(true, fake => fake.listIssues.mockResolvedValue([issue, secondIssue]));}

it('cannot apply an old failed readiness decision to a replacement assignment', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  const checks: ((value: string | null) => void)[] = []; swarm.capabilityPreflight = () => new Promise(resolve => {checks.push(resolve);});
  await swarm.assign(agent.id, 1); swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2);
  expect(checks).toHaveLength(2); checks[0]('Old synthetic failure'); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'preparing', issueNumber: 2, lastError: null});
  checks[1](null); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.prepareDesk.mock.calls[0][3]).toContain('issue-2');
});

it('serializes cancelled and replacement worktree preparation without launching the old task', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let prepared!: (value: string) => void;
  fake.prepareDesk.mockImplementationOnce(() => new Promise(resolve => {prepared = resolve;}));
  await swarm.assign(agent.id, 1); await vi.waitFor(() => expect(fake.prepareDesk).toHaveBeenCalledOnce());
  swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.prepareDesk).toHaveBeenCalledOnce(); prepared(HOME_DIR);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.prepareDesk).toHaveBeenCalledTimes(2); expect((fake.startSession.mock.calls[0][0] as {prompt: string}).prompt).toContain('#2');
});

it('ignores obsolete session callbacks and retains the replacement session handle', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  const old = fake.startSession.mock.calls[0][1]; swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledTimes(2));
  const replacement = fake.startSession.mock.results[1].value; const usage = swarm.snapshot().usage;
  old.sessionId('obsolete-session'); old.tool('obsolete-tool'); old.browserUrl('https://obsolete.test');
  old.log([{kind: 'text', text: 'obsolete log'}]); old.screenshot(Buffer.from('obsolete'), 'image/png'); old.limited?.(Date.now() + 60000);
  old.finished({ok: true, text: 'https://github.com/synthetic/repo/pull/7', costUsd: 99, turns: 99, errors: []});
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'working', issueNumber: 2, prNumber: null, costUsd: 0, turns: 0, hasScreenshot: false});
  expect(swarm.snapshot().usage).toEqual(usage); expect(swarm.snapshot().qa).toHaveLength(0);
  await swarm.message(agent.id, 'Current follow-up'); expect(replacement.send).toHaveBeenCalledExactlyOnceWith('Current follow-up');
});

it('discards a PR lookup that finishes after its task was replaced', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let found!: (value: {number: number; url: string}) => void;
  fake.prForBranch.mockImplementationOnce(() => new Promise(resolve => {found = resolve;}));
  await swarm.assign(agent.id, 1); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  fake.startSession.mock.calls[0][1].finished({ok: true, text: 'No PR link in this result', costUsd: 0, turns: 1, errors: []});
  expect(found).toBeTypeOf('function'); swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2);
  found({number: 7, url: 'https://example.test/pr/7'}); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'working', issueNumber: 2, prNumber: null});
  expect(swarm.snapshot().qa).toHaveLength(0);
});

it('stops remaining QA uploads and refuses an old approval after the reviewer is reassigned', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); const reviewer = swarm.snapshot().agents.find(a => a.role === 'qa')!;
  callbacks.screenshot(Buffer.from('synthetic image one'), 'image/png'); callbacks.screenshot(Buffer.from('synthetic image two'), 'image/png');
  let uploaded!: (value: string) => void;
  fake.uploadEvidence.mockImplementationOnce(() => new Promise(resolve => {uploaded = resolve;}));
  callbacks.finished({ok: true, text: '', structured: {...qaReport, screenshots: ['First image', 'Second image']}, costUsd: 0, turns: 1, errors: []});
  expect(uploaded).toBeTypeOf('function'); swarm.stopAgent(reviewer.id); swarm.resetAgent(reviewer.id);
  await swarm.sendToQa('synthetic/repo', 7); await vi.advanceTimersByTimeAsync(200);
  expect(fake.startSession).toHaveBeenCalledTimes(2); uploaded('https://example.test/evidence');
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(fake.uploadEvidence).toHaveBeenCalledOnce(); expect(fake.commentPull).not.toHaveBeenCalled();
  expect(swarm.snapshot().qa[0].status).toBe('testing');
});
