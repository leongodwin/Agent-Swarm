import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';
import type { SessionCallbacks } from './agentRunner.ts';

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
    listIssues: vi.fn(async () => [issue]), listPulls: vi.fn(async () => []), syncMain: vi.fn(async () => null),
    prDetails: vi.fn(async () => ({state: 'OPEN'})),
    mainDir: () => HOME_DIR, deskDir: () => HOME_DIR, prepareDesk: vi.fn(async () => HOME_DIR),
    startSession: vi.fn((_opts: unknown, _cb: SessionCallbacks) => ({stop: vi.fn(), send: vi.fn()})),
    previews: {hasDefault: vi.fn(async () => false), start: vi.fn(() => {throw new Error('Unexpected preview execution');})},
    office: {head: vi.fn(async () => null), takeLastUpdate: vi.fn(async () => null)},
  };
  return external;
}
async function office(withRepo = false) {
  const persisted = {version: 2, settings: {runtime: 'sdk', ceoHeartbeatMin: 0},
    repos: withRepo ? [{id: 'synthetic/repo', fullName: 'synthetic/repo', defaultBranch: 'main', floor: 1, color: '#000', description: '', url: '', autoAssign: false, autoMerge: false, browserTesting: false, addedAt: 1}] : []};
  await fs.writeFile(STATE_FILE, JSON.stringify(persisted));
  const fake = backend(); const swarm = new Swarm(fake as unknown as Backend); offices.push(swarm);
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
