import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createDemoBackend, setDemoPrDiff } from './demo.ts';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import type { AgentTerminal } from './terminal.ts';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5); });
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });
const options = (prompt: string, role: SessionOptions['role'] = 'dev'): SessionOptions => ({ cwd: '/demo/desk', prompt, role, systemAppend: '', model: 'demo', effort: 'medium', browserTesting: true, additionalDirectories: [] });
const callbacks = (): SessionCallbacks => ({ log: vi.fn(), tool: vi.fn(), sessionId: vi.fn(), browserUrl: vi.fn(), screenshot: vi.fn(), finished: vi.fn(), turn: vi.fn(), usageWarning: vi.fn() });
let seq = 0;
async function project() {
  const backend = createDemoBackend(); const result = await backend.createProject('/demo/projects', `qa-project-${++seq}`, { visibility: 'private' });
  return { backend, repo: result.fullName };
}
async function desk(backend: ReturnType<typeof createDemoBackend>, repo: string) {
  const pending = backend.prepareDesk(repo, { defaultBranch: 'main' }, 'qa-desk', 'swarm/qa'); await vi.advanceTimersByTimeAsync(900); return pending;
}

describe('synthetic backend parity acceptance', () => {
  it('discovers metadata and projects without invoking real accounts or tools', async () => {
    const { backend, repo } = await project(); expect(backend.demo).toBe(true); expect(await backend.user()).toBe('demo-manager');
    expect((await backend.listMyRepos()).some(r => r.nameWithOwner === repo)).toBe(true);
    expect(await backend.repoMeta(repo)).toMatchObject({ nameWithOwner: repo, defaultBranch: 'main' });
    await expect(backend.repoMeta('missing/repo')).rejects.toThrow('Unknown');
    expect((await backend.scanProjects('/demo')).some(f => !f.git)).toBe(true);
    expect((await backend.inspectFolder('C:\\demo\\sketchbook')).name).toBe('sketchbook');
    await expect(backend.inspectFolder('/missing')).rejects.toThrow('not a folder');
    expect(await backend.publishFolder('/demo/projects/sketchbook', { name: 'ignored', visibility: 'private' })).toBe('demo-co/sketchbook');
    expect(await backend.publishFolder(`/demo/projects/${repo.split('/')[1]}`, { name: 'ignored', visibility: 'private' })).toBe(repo);
    await expect(backend.createProject('/demo', repo.split('/')[1], { visibility: 'private' })).rejects.toThrow('already exists');
    expect(await backend.reconnectClis(() => null)).toEqual([]); expect((await backend.detectClis()).every(c => c.installed && c.version === 'demo')).toBe(true);
    backend.setLocalPath(repo, null); backend.hooksReady(); await backend.releaseClis(false); await backend.removeDesk(repo, 'x'); await backend.releaseDesk(repo, 'x', 0);
    expect(backend.mainDir(repo)).toContain(repo); expect(backend.deskDir(repo, 'ada')).toContain('/desks/ada');
    const clone = backend.ensureClone(repo); await vi.advanceTimersByTimeAsync(400); await clone;
  });
  it('keeps issue edits and missing-state behavior consistent', async () => {
    const { backend, repo } = await project(); const n = await backend.createIssue(repo, 'Synthetic task', 'original', ['one', 'keep']);
    expect(await backend.issueState(repo, n)).toBe('OPEN'); expect(await backend.issueState(repo, 999)).toBeNull();
    await backend.editIssue(repo, n, { body: '', addLabels: ['one', 'new'], removeLabels: ['one'] });
    expect((await backend.listIssues(repo))[0]).toMatchObject({ body: '', labels: ['keep', 'new'] });
    await backend.editIssue(repo, n, {}); expect(await backend.issueDetails(repo, n)).toEqual({ title: 'Synthetic task', body: '' });
    expect(await backend.issueDetails(repo, 99)).toEqual({ title: 'Issue #99', body: '' });
    expect(await backend.listIssues('missing/repo')).toEqual([]); expect(await backend.listPulls('missing/repo')).toEqual([]);
    await expect(backend.createIssue('missing/repo', 'x', 'x')).rejects.toThrow('Unknown'); await expect(backend.editIssue(repo, 99, {})).rejects.toThrow('Unknown');
    expect(await backend.prForBranch(repo, 'missing')).toBeNull(); await expect(backend.prDetails(repo, 9)).rejects.toThrow('Unknown');
    await expect(backend.mergePull(repo, 9, 'squash')).rejects.toThrow('Unknown'); await expect(backend.updateBranch(repo, 9)).rejects.toThrow('Unknown'); await backend.closePull(repo, 9);
    expect(await backend.prDiff(repo, 9)).toBe(''); expect(await backend.prFiles(repo, 9, 'head')).toEqual([]);
    setDemoPrDiff(repo, 9, 'synthetic diff'); expect(await backend.prDiff(repo, 9)).toBe('synthetic diff'); expect(await backend.prFiles(repo, 9, 'head')).toEqual([{ file: 'Workflows/demo.json', content: 'synthetic diff' }]);
    expect(await backend.commentPull(repo, 9, 'synthetic')).toContain('#issuecomment-'); expect(await backend.uploadEvidence(repo, 'evidence.png', Buffer.from('synthetic'))).toContain('/raw/swarm-qa-evidence/evidence.png');
  });
  it('runs developer to PR to fix to pinned-head merge and keeps sync read-only until requested', async () => {
    const { backend, repo } = await project(); const issue = await backend.createIssue(repo, 'Synthetic feature', 'demo');
    const cwd = await desk(backend, repo), cb = callbacks(); const handle = backend.startSession({ ...options(`#${issue}: Synthetic feature`), cwd }, cb);
    handle.send('synthetic adjustment'); await vi.runAllTimersAsync();
    expect(cb.browserUrl).toHaveBeenCalled(); expect(cb.screenshot).toHaveBeenCalled(); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    const [pr] = await backend.listPulls(repo); expect(pr).toMatchObject({ closesIssues: [issue], checks: 'passing' });
    expect(await backend.prDetails(repo, pr.number)).toMatchObject({ state: 'OPEN', headSha: pr.headSha });
    await expect(backend.mergePull(repo, pr.number, 'squash', 'stale')).rejects.toThrow('modified');
    const before = pr.headSha; backend.startSession({ ...options(`FAILED pull request #${pr.number}: Synthetic feature`), cwd }, callbacks()); await vi.runAllTimersAsync();
    expect(pr.headSha).not.toBe(before); const fixed = pr.headSha; await backend.updateBranch(repo, pr.number); await vi.runAllTimersAsync(); expect(pr.headSha).not.toBe(fixed);
    await backend.mergePull(repo, pr.number, 'squash', pr.headSha); expect(await backend.issueState(repo, issue)).toBe('CLOSED'); expect(await backend.listIssues(repo)).toEqual([]);
    expect(await backend.syncMain(repo, 'main', { touch: false })).toEqual({ status: 'update ready (1 commit)', behind: 1, updatable: true });
    expect(await backend.syncMain(repo, 'main', { touch: false })).toMatchObject({ behind: 1 });
    expect(await backend.syncMain(repo, 'main', { touch: true })).toMatchObject({ behind: 0, updatable: false }); expect(await backend.syncMain(repo, 'main', { touch: true })).toMatchObject({ status: 'in sync' });
    const next = await backend.createIssue(repo, 'Second synthetic', 'demo'); backend.startSession({ ...options(`#${next}: Second synthetic`), cwd }, callbacks()); await vi.runAllTimersAsync();
    const [closed] = await backend.listPulls(repo); await backend.closePull(repo, closed.number); expect((await backend.prDetails(repo, closed.number)).state).toBe('CLOSED');
  });
  it('rejects closed and previously merged PRs without creating additional sync work', async () => {
    const { backend, repo } = await project(); const n = await backend.createIssue(repo, 'Synthetic', 'demo'); const cwd = await desk(backend, repo);
    backend.startSession({ ...options(`#${n}: Synthetic`), cwd }, callbacks()); await vi.runAllTimersAsync(); const [closed] = await backend.listPulls(repo); await backend.closePull(repo, closed.number);
    await expect(backend.mergePull(repo, closed.number, 'squash', closed.headSha)).rejects.toThrow(/not open/i);
    expect(await backend.syncMain(repo, 'main', { touch: false })).toMatchObject({ behind: 0 }); expect(await backend.issueState(repo, n)).toBe('OPEN');
    backend.startSession({ ...options(`#${n}: Synthetic`), cwd }, callbacks()); await vi.runAllTimersAsync(); const [open] = await backend.listPulls(repo); await backend.mergePull(repo, open.number, 'squash', open.headSha);
    await expect(backend.mergePull(repo, open.number, 'squash', open.headSha)).rejects.toThrow(/not open/i);
    expect(await backend.syncMain(repo, 'main', { touch: false })).toMatchObject({ behind: 1 });
  });
  it.each([['qa', 'QA round 1 pull request #12: Synthetic feature', 0, 'fail'], ['qa', 'QA round 2 pull request #12: Synthetic feature', 0, 'pass']] as const)('returns scripted QA evidence for %s %#', async (role, prompt, random, verdict) => {
    vi.mocked(Math.random).mockReturnValue(random); const backend = createDemoBackend(), cb = callbacks(); backend.startSession(options(prompt, role), cb); await vi.runAllTimersAsync();
    expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: true, structured: expect.objectContaining({ verdict, checks: expect.any(Array), screenshots: expect.any(Array) }) })); expect(cb.screenshot).toHaveBeenCalledTimes(2);
  });
  it('stops pending fake sessions and does not emit delayed manager messages or completion', async () => {
    const backend = createDemoBackend(), cb = callbacks(), handle = backend.startSession(options('follow-up'), cb); handle.send('later'); handle.stop(); await vi.runAllTimersAsync();
    expect(cb.finished).toHaveBeenCalledTimes(1); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: false, errors: ['Stopped by manager'] })); expect(cb.log).not.toHaveBeenCalled();
  });
  it('shows simulated failing CI and pending multiple merges without treating them as deployment evidence', async () => {
    vi.mocked(Math.random).mockReturnValue(0); const { backend, repo } = await project(), cwd = await desk(backend, repo);
    for (const title of ['First', 'Second']) {
      const n = await backend.createIssue(repo, title, 'demo'); backend.startSession({ ...options(`#${n}: ${title}`), cwd }, callbacks()); await vi.runAllTimersAsync();
      const [pr] = await backend.listPulls(repo); expect(pr).toMatchObject({ checks: 'failing', failedChecks: [{ name: 'CI / build', url: `${pr.url}/checks` }] });
      await backend.mergePull(repo, pr.number, 'squash', pr.headSha);
    }
    expect(await backend.syncMain(repo, 'main', { touch: false })).toEqual({ status: 'update ready (2 commits)', behind: 2, updatable: true });
  });
  it('updates only fake office state and correlates commit counts to its own synthetic update', async () => {
    const backend = createDemoBackend(); expect(await backend.office.head()).toMatch(/^[a-f0-9]{40}$/);
    expect(backend.office.isOwnFolder('/demo/contoso/copilot-customer-service/main')).toBe(true); expect(backend.office.isOwnFolder('/demo/unrelated/main')).toBe(false);
    expect(await backend.office.commitsBetween('before', 'unknown')).toBeNull();
    const pending = backend.office.update('synthetic-old'); await vi.advanceTimersByTimeAsync(4000); const result = await pending;
    expect(result).toMatchObject({ from: 'synthetic-old', ok: true, installed: true, built: true }); if (!result) throw new Error('Synthetic update returned no receipt'); expect(await backend.office.commitsBetween('before', result.to)).toBe(0);
  });
  it('mirrors a demo session to the terminal, edits manager input and unbinds on finish', async () => {
    const backend = createDemoBackend(), cb = callbacks(); let input!: { write(data: string): void; resize(): void };
    const term = { note: vi.fn(), write: vi.fn(), bind: vi.fn(value => { if (value) input = value; }) };
    backend.startSession({ ...options('follow-up'), cli: 'codex', label: 'Demo worker', terminal: term as unknown as AgentTerminal }, cb);
    input.write('\x1b[31mabc\x7f\bD\r\r'); input.resize(); await vi.runAllTimersAsync();
    expect(cb.log).toHaveBeenCalledWith([{ kind: 'manager', text: '▶ Typed in the terminal: aD' }]);
    expect(cb.log).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Got it') })]));
    expect(term.bind).toHaveBeenLastCalledWith(null); expect(term.note).toHaveBeenCalledWith(expect.stringContaining('session ended')); expect(term.write).toHaveBeenCalled();
  });
  it('supports unlabeled default terminal sessions without leaking control characters into manager messages', async () => {
    const backend = createDemoBackend(), cb = callbacks(); let input!: { write(data: string): void; resize(): void };
    const term = { note: vi.fn(), write: vi.fn(), bind: vi.fn(value => { if (value) input = value; }) };
    backend.startSession({ ...options('Synthetic follow-up'), model: '', terminal: term as unknown as AgentTerminal }, cb);
    input.write('\b\x7f\n\x01x\r'); await vi.runAllTimersAsync(); expect(cb.log).toHaveBeenCalledWith([{ kind: 'manager', text: '▶ Typed in the terminal: x' }]);
    expect(term.write).toHaveBeenCalledWith(expect.stringContaining('default model')); expect(term.note).toHaveBeenCalledWith('── GitHub Copilot CLI ──');
  });
  it('does not resume a fake worker when cancellation occurs from a synchronous progress callback', async () => {
    const backend = createDemoBackend(), cb = callbacks(); let handle!: ReturnType<typeof backend.startSession>; vi.mocked(cb.log).mockImplementationOnce(() => handle.stop());
    handle = backend.startSession(options('Synthetic follow-up'), cb); await vi.runAllTimersAsync(); handle.send('late message'); await vi.runAllTimersAsync();
    expect(cb.finished).toHaveBeenCalledTimes(1); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: false })); expect(cb.log).toHaveBeenCalledTimes(1);
  });
  it('finishes a missing fake PR repair without inventing a pull request and shares published project identities', async () => {
    const backend = createDemoBackend(), cb = callbacks(); backend.startSession(options('FAILED pull request #9999: Synthetic missing repair'), cb); await vi.runAllTimersAsync(); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    const other = createDemoBackend(); expect(await backend.publishFolder('/demo/projects/recipe-notes', { name: 'ignored', visibility: 'private' })).toBe('demo-co/recipe-notes');
    expect(await other.publishFolder('/demo/projects/recipe-notes', { name: 'ignored', visibility: 'private' })).toBe('demo-co/recipe-notes');
  });
  it('exercises successful simulated previews and HTTP errors through a mocked listener only', async () => {
    const backend = createDemoBackend(); let serve!: http.RequestListener; let listening!: () => void;
    const server = Object.assign(new EventEmitter(), { listening: false, listen: vi.fn((_port: number, _host: string, cb: () => void) => { listening = cb; }), closeAllConnections: vi.fn(), close: vi.fn((cb?: () => void) => { cb?.(); }) });
    vi.spyOn(http, 'createServer').mockImplementation(((handler: http.RequestListener) => { serve = handler; return server; }) as unknown as typeof http.createServer);
    const cb = { status: vi.fn(), log: vi.fn(), commit: vi.fn(), failed: vi.fn() };
    const job = { fullName: 'contoso/copilot-customer-service', defaultBranch: 'main', pr: null, port: 0, command: 'node preview {port}', env: {}, title: '<Copilot & customer>' };
    const handle = backend.previews.start(job, cb); await vi.advanceTimersByTimeAsync(1600); server.listening = true; listening(); await vi.advanceTimersByTimeAsync(500);
    expect(cb.status).toHaveBeenLastCalledWith('running');
    const response = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() };
    serve({ url: '/?demo=1' } as http.IncomingMessage, response as unknown as http.ServerResponse); expect(response.writeHead).toHaveBeenLastCalledWith(200, expect.objectContaining({ 'Cache-Control': 'no-store' }));
    expect(response.end).toHaveBeenLastCalledWith(expect.stringContaining('<title>Copilot  customer'));
    serve({ url: '/missing' } as http.IncomingMessage, response as unknown as http.ServerResponse); expect(response.writeHead).toHaveBeenLastCalledWith(404);
    await handle.stop(); expect(server.closeAllConnections).toHaveBeenCalledOnce();
    const second = backend.previews.start({ ...job, title: 'Claims inspection', command: null, fullName: 'contoso/claims-pcf-controls', pr: 3 }, cb);
    await vi.advanceTimersByTimeAsync(1600); listening(); await vi.advanceTimersByTimeAsync(500); serve({ url: '/' } as http.IncomingMessage, response as unknown as http.ServerResponse);
    expect(response.end).toHaveBeenLastCalledWith(expect.stringContaining('POWER APPS MODEL-DRIVEN')); server.emit('error', new Error('synthetic bind error')); expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('synthetic bind error')); await second.stop();
  });
  it('closes a late simulated listen acknowledgement after stop instead of announcing a running preview', async () => {
    let listening!: () => void; const server = Object.assign(new EventEmitter(), { listening: false, listen: vi.fn((_port: number, _host: string, cb: () => void) => { listening = cb; }), closeAllConnections: vi.fn(), close: vi.fn() });
    vi.spyOn(http, 'createServer').mockReturnValue(server as unknown as http.Server); const backend = createDemoBackend(), cb = { status: vi.fn(), log: vi.fn(), commit: vi.fn(), failed: vi.fn() };
    const handle = backend.previews.start({ fullName: 'contoso/claims-pcf-controls', defaultBranch: 'main', pr: null, port: 0, command: 'node demo', env: {}, title: 'Synthetic' }, cb);
    await vi.advanceTimersByTimeAsync(1600); await handle.stop(); listening(); server.emit('error', new Error('late ignored')); await vi.runAllTimersAsync(); expect(server.close).toHaveBeenCalledOnce(); expect(cb.status).not.toHaveBeenCalledWith('running'); expect(cb.failed).not.toHaveBeenCalled();
  });
  it('fails bare and unknown-program previews without opening a listener, and cancels pending startup', async () => {
    const { backend, repo } = await project(); const cb = { status: vi.fn(), log: vi.fn(), commit: vi.fn(), failed: vi.fn() };
    const job = { fullName: repo, defaultBranch: 'main', pr: null, port: 0, command: null, env: {}, title: 'Synthetic' };
    expect(await backend.previews.hasDefault(repo)).toBe(false); expect(await backend.previews.hasDefault('contoso/claims-pcf-controls')).toBe(true);
    const first = backend.previews.start(job, cb); await vi.runAllTimersAsync(); expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('Nothing to run'), true); await first.stop();
    cb.failed.mockClear(); const second = backend.previews.start({ ...job, pr: 9, command: 'not-a-program' }, cb); await vi.runAllTimersAsync(); expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('code 1')); await second.stop();
    cb.failed.mockClear(); const third = backend.previews.start({ ...job, command: 'node demo' }, cb); await third.stop(); await vi.runAllTimersAsync(); expect(cb.failed).not.toHaveBeenCalled();
  });
});

describe('scripted CEO office-tool acceptance', () => {
  function office(floors: unknown[] = []) { return { call: vi.fn(async (name: string) => name === 'company_status' ? JSON.stringify({ floors, pendingProposals: [] }) : name === 'file_issue' ? 'Created #7' : name === 'agent_detail' ? JSON.stringify({ title: 'QA', jobDescription: null }) : 'OK') }; }
  async function run(prompt: string, floors: unknown[] = []) {
    const backend = createDemoBackend(), cb = callbacks(), tools = office(floors); backend.startSession({ ...options(prompt, 'ceo'), office: tools as unknown as OfficeTools }, cb); await vi.runAllTimersAsync(); return { cb, tools };
  }
  const floor = (team: unknown[] = [], backlog: unknown[] = [], brief: string | null = null) => ({ floor: 1, repo: 'contoso/copilot-customer-service', brief, team, backlog, pullRequests: [] });
  it('handles missing onboard/planning floors, empty status and ordinary chat', async () => {
    expect((await run('Floor 9 (missing/repo) just joined the company')).cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('gone') }));
    expect((await run('has a brief for floor 9 (missing/repo) """build demo"""')).cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('gone') }));
    expect((await run('Periodic review')).cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('No changes needed') }));
    expect((await run('Manager\nWhat next?')).cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('no projects yet') }));
  });
  it('onboards floor roles and plans dependency-bound issues through office tools', async () => {
    const team = [{ id: 'qa', name: 'QA', role: 'qa', specialty: null, status: 'idle' }, { id: 'dev', name: 'Dev', role: 'dev', specialty: null, status: 'idle' }];
    const { cb, tools } = await run('Floor 1 (contoso/copilot-customer-service) just joined the company', [floor(team, [], 'build demo')]);
    expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: true, text: expect.stringContaining('three issues') }));
    expect(tools.call.mock.calls.filter(([name]) => name === 'file_issue')).toHaveLength(3); expect(tools.call).toHaveBeenCalledWith('update_job', expect.objectContaining({ agent_id: 'qa' }));
    expect(tools.call).toHaveBeenCalledWith('file_issue', expect.objectContaining({ body: expect.stringContaining('Depends on #7') }));
    const planned = await run('has a brief for floor 1 (generic/repo) """build demo"""', [floor([], [])]); expect(planned.tools.call).toHaveBeenCalledWith('propose_hire', expect.objectContaining({ specialty: 'frontend' }));
  });
  it('routes a concrete idle issue and recommends reducing only clearly excessive capacity', async () => {
    const specialist = { id: 'dev', name: 'Dev', role: 'dev', specialty: 'flows', status: 'idle' };
    const routed = await run('Periodic review', [floor([specialist], [{ number: 8, specialty: null, inProgress: false }])]); expect(routed.tools.call).toHaveBeenCalledWith('route_issue', { floor: 1, number: 8, specialty: 'flows' });
    const team = Array.from({ length: 6 }, (_, n) => ({ id: `dev${n}`, name: `Dev${n}`, role: 'dev', specialty: null, status: n % 2 ? 'done' : 'idle' }));
    expect((await run('Periodic review', [floor(team)])).tools.call).toHaveBeenCalledWith('propose_let_go', expect.objectContaining({ agent_id: 'dev5' }));
  });
  it('reports office failures and stops queued CEO sessions once', async () => {
    const backend = createDemoBackend(), cb = callbacks(); const tools = { call: vi.fn(async () => { throw new Error('synthetic unavailable'); }) };
    backend.startSession({ ...options('Periodic review', 'ceo'), office: tools as unknown as OfficeTools }, cb); await vi.runAllTimersAsync(); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ ok: false, errors: ['synthetic unavailable'] }));
    const stopped = callbacks(), handle = backend.startSession({ ...options('Periodic review', 'ceo'), office: office() as unknown as OfficeTools }, stopped); handle.send('pending'); handle.stop(); handle.stop(); await vi.runAllTimersAsync(); expect(stopped.finished).toHaveBeenCalledTimes(1);
  });
  it('does not invent issue dependencies after refusal and avoids duplicate frontend hires', async () => {
    const backend = createDemoBackend(), cb = callbacks(), team = [{ id: 'frontend', name: 'Frontend', role: 'dev', specialty: 'frontend', status: 'idle' }];
    const tools = { call: vi.fn(async (name: string) => name === 'company_status' ? JSON.stringify({ floors: [floor(team)], pendingProposals: [] }) : 'Refused: synthetic policy') };
    backend.startSession({ ...options(`has a brief for floor 1 (generic/repo) """${'long mission '.repeat(20)}"""`, 'ceo'), office: tools as unknown as OfficeTools }, cb); await vi.runAllTimersAsync();
    const issues = tools.call.mock.calls.filter(([name]) => name === 'file_issue'); expect(issues).toHaveLength(3);
    expect(issues[1]).toEqual(['file_issue', expect.objectContaining({ title: expect.stringContaining('…'), body: expect.not.stringContaining('Depends on #') })]);
    expect(tools.call.mock.calls.some(([name]) => name === 'propose_hire')).toBe(false); expect(cb.log).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ kind: 'error', text: expect.stringContaining('Refused') })]));
  });
  it('retains refusals and supports generic onboarding and rich status with pending decisions', async () => {
    const backend = createDemoBackend(), cb = callbacks(), tools = { call: vi.fn(async (name: string) => name === 'company_status' ? JSON.stringify({ floors: [{ ...floor([], [{ number: 9 }]), repo: 'demo/generic' }], pendingProposals: [{}, {}] }) : 'Refused: synthetic policy') };
    backend.startSession({ ...options('Floor 1 (demo/generic) just joined the company', 'ceo'), office: tools as unknown as OfficeTools }, cb); await vi.runAllTimersAsync();
    expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Web project') }));
    expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.not.stringContaining("I've proposed hiring") }));
    const chat = callbacks(); const handle = backend.startSession({ ...options('Manager\nLong ordinary message', 'ceo'), office: tools as unknown as OfficeTools }, chat); handle.send(`Manager\n${'long message '.repeat(20)}`); await vi.runAllTimersAsync();
    expect(chat.turn).toHaveBeenCalledWith(expect.stringContaining('Noted')); expect(chat.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('**2** proposals') }));
    handle.send('too late'); await vi.runAllTimersAsync(); expect(chat.finished).toHaveBeenCalledTimes(1);
  });
  it('falls back to a healthy review when an issue-routing action is refused', async () => {
    const backend = createDemoBackend(), cb = callbacks(); const tools = { call: vi.fn(async (name: string) => name === 'company_status' ? JSON.stringify({ floors: [floor([{ id: 'dev', name: 'Dev', role: 'dev', specialty: 'flows', status: 'working' }], [{ number: 8, specialty: null, inProgress: false }])], pendingProposals: [] }) : 'Refused: synthetic policy') };
    backend.startSession({ ...options('Periodic review', 'ceo'), office: tools as unknown as OfficeTools }, cb); await vi.runAllTimersAsync(); expect(tools.call).toHaveBeenCalledWith('route_issue', expect.objectContaining({ number: 8 })); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('No changes needed') }));
  });
  it('handles malformed onboard and planning notifications without guessing an existing floor', async () => {
    expect((await run('A project just joined the company')).cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('gone') }));
    expect((await run('Manager has a brief for floor unknown')).cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('gone') }));
  });
  it('does not execute office actions after cancellation is requested during status collection', async () => {
    const backend = createDemoBackend(), cb = callbacks(); let handle!: ReturnType<typeof backend.startSession>;
    const tools = { call: vi.fn(async () => { handle.stop(); return JSON.stringify({ floors: [], pendingProposals: [] }); }) };
    handle = backend.startSession({ ...options('Periodic review', 'ceo'), model: '', office: tools as unknown as OfficeTools }, cb); await vi.runAllTimersAsync(); expect(cb.finished).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ok: false, errors: ['Stopped by manager'] })); expect(tools.call).toHaveBeenCalledTimes(1);
  });
  it('supports a single pending hiring decision and preserves a plain manager message while a CEO job is active', async () => {
    const backend = createDemoBackend(), cb = callbacks(), tools = { call: vi.fn(async () => JSON.stringify({ floors: [{ ...floor(), repo: 'contoso/claims-pcf-controls' }], pendingProposals: [{}] })) };
    const handle = backend.startSession({ ...options('Manager\nStatus please', 'ceo'), office: tools as unknown as OfficeTools }, cb); handle.send('plain manager message'); await vi.runAllTimersAsync();
    expect(cb.turn).toHaveBeenCalledWith('Noted, I\'ll factor that in: "plain manager message"'); expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('**1** proposal is waiting') }));
  });
});
