import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Previews, parsePreviewPatch, type PreviewFloor } from './previews.ts';
import type { Backend } from './backend.ts';
import type { PreviewCallbacks } from './previewRunner.ts';
vi.mock('./previewRunner.ts', async original => ({ ...await original<typeof import('./previewRunner.ts')>(), portOpen: vi.fn(async () => false) }));
import { portOpen } from './previewRunner.ts';

const floor: PreviewFloor = { id: 'synthetic', fullName: 'synthetic/repo', defaultBranch: 'main', floor: 1, preview: { command: null, env: {} } };
beforeEach(() => { vi.useFakeTimers(); vi.mocked(portOpen).mockResolvedValue(false); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('preview configuration acceptance', () => {
  it('normalises absent, cleared and trimmed command/environment patches', () => {
    expect(parsePreviewPatch(undefined, undefined)).toEqual({});
    expect(parsePreviewPatch(null, null)).toEqual({ command: null, env: {} });
    expect(parsePreviewPatch(' \n ', { _URL: 'demo' })).toEqual({ command: null, env: { _URL: 'demo' } });
    expect(parsePreviewPatch(' node app.js ', {})).toEqual({ command: 'node app.js', env: {} });
  });
  it.each([
    [42, undefined, 'string or null'], ['a'.repeat(2001), undefined, 'too long'],
    [undefined, [], 'object'], [undefined, 'x', 'object'],
    [undefined, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`K${i}`, 'x'])), 'too many'],
    [undefined, { PORT: 123 }, 'must be a string'], [undefined, { 'bad-key': 'x' }, 'valid environment'],
    [undefined, { ANTHROPIC_API_KEY: 'synthetic' }, "can't be set"],
    [undefined, { ClaudeAnything: 'synthetic' }, "can't be set"], [undefined, { VALUE: 'x'.repeat(4001) }, 'too long'],
  ])('rejects invalid or excluded configuration %#', (command, env, message) => {
    expect(() => parsePreviewPatch(command, env)).toThrow(message as string);
  });
});

function fixture() {
  let callbacks!: PreviewCallbacks;
  const stop = vi.fn(async () => {}), emit = vi.fn(), removeDesk = vi.fn(async () => {}), releaseDesk = vi.fn(async () => {});
  const start = vi.fn((_job: unknown, cb: PreviewCallbacks) => { callbacks = cb; return { stop }; });
  const hasDefault = vi.fn(async () => true), prDetails = vi.fn(async () => ({ state: 'OPEN' }));
  const previews = new Previews({ previews: { start, hasDefault }, removeDesk, releaseDesk, prDetails } as unknown as Backend, { emit, pulls: () => [] });
  return { previews, start, stop, emit, removeDesk, releaseDesk, hasDefault, prDetails, cb: () => callbacks };
}

describe('preview coordinator acceptance', () => {
  it('reports unconfigured only after an explicit negative default observation, tolerates discovery errors and avoids duplicate emits', async () => {
    const f = fixture(); expect(f.previews.view(floor)).toMatchObject({ status: 'stopped', url: null, port: 6301 });
    f.hasDefault.mockResolvedValue(false); await f.previews.refreshDefault(floor); await f.previews.refreshDefault(floor);
    expect(f.emit).toHaveBeenCalledTimes(1); expect(f.previews.view(floor).status).toBe('unconfigured');
    expect(f.previews.view({ ...floor, preview: { command: 'node app', env: {} } }).status).toBe('stopped');
    f.hasDefault.mockRejectedValue(new Error('synthetic unavailable')); await f.previews.refreshDefault(floor);
    expect(f.previews.view(floor).status).toBe('stopped'); await f.previews.close([floor]);
    await f.previews.refreshDefault(floor); expect(f.hasDefault).toHaveBeenCalledTimes(3);
  });
  it('validates PR identity and state before launching', async () => {
    const f = fixture();
    for (const pr of [0, -1, 1.5]) await expect(f.previews.start(floor, 'demo', pr)).rejects.toThrow('Invalid');
    f.prDetails.mockResolvedValue({ state: 'CLOSED' }); await expect(f.previews.start(floor, 'demo', 8)).rejects.toThrow('closed');
    f.prDetails.mockRejectedValue(new Error('missing')); await expect(f.previews.start(floor, 'demo', 9)).rejects.toThrow('no pull');
    expect(f.start).not.toHaveBeenCalled(); await f.previews.close([floor]);
  });
  it('never displaces an unrelated process occupying its reserved port', async () => {
    const f = fixture(); vi.mocked(portOpen).mockResolvedValue(true);
    await expect(f.previews.start(floor, 'demo')).rejects.toThrow('already in use');
    expect(f.previews.view(floor)).toMatchObject({ status: 'error', url: null });
    expect(f.start).not.toHaveBeenCalled(); expect(f.releaseDesk).not.toHaveBeenCalled(); await f.previews.close([floor]);
  });
  it('allocates distinct active ports and keeps the active reservation stable when floors move', async () => {
    const f = fixture(); await f.previews.start(floor, 'demo');
    expect(f.previews.portFor({ ...floor, floor: 3 })).toBe(6301);
    expect(f.previews.portFor({ ...floor, id: 'other' })).toBe(6401);
    expect(f.previews.portFor({ ...floor, id: 'office', floor: -1983 })).toBe(4417);
    expect(f.previews.portFor({ ...floor, id: 'agents', floor: -1100 })).toBe(5900);
    await f.previews.close([floor]);
  });
  it('bounds logs, batches notifications and ignores callbacks from replaced runs', async () => {
    const f = fixture(); await f.previews.start(floor, 'demo', 8); const old = f.cb();
    old.status('running'); old.commit('abc'); old.log(Array.from({ length: 250 }, (_, n) => `${n} ${'x'.repeat(600)}`));
    const view = f.previews.view(floor); expect(view).toMatchObject({ status: 'running', commit: 'abc', ref: 'PR #8', pr: 8, url: 'http://localhost:6301/' });
    expect(view.logTail).toHaveLength(40); expect(view.logTail[0]).toMatch(/^210 /); expect(view.logTail[0]).toHaveLength(500);
    const before = f.emit.mock.calls.length; old.log(['last']); expect(f.emit).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1000); expect(f.emit).toHaveBeenCalledTimes(before + 1);
    await f.previews.start(floor, 'replacement'); old.status('running'); old.commit('stale'); old.failed('stale'); old.log(['stale']);
    expect(f.previews.view(floor)).toMatchObject({ status: 'preparing', commit: null, error: null, logTail: [] });
    f.cb().commit(''); expect(f.previews.view(floor).commit).toBeNull();
    f.cb().failed('no package', true); expect(f.previews.view(floor)).toMatchObject({ status: 'unconfigured', error: 'no package' });
    await f.previews.stop(floor); expect(f.previews.view(floor).status).toBe('unconfigured');
    await f.previews.remove(floor); expect(f.removeDesk).toHaveBeenCalledWith(floor.fullName, 'preview');
    expect(f.previews.view(floor).status).toBe('stopped'); await f.previews.close([floor]);
  });
  it('does not delete a worktree until cleanup succeeds and tolerates orphan discovery failures', async () => {
    const f = fixture(); await f.previews.start(floor, 'demo'); f.cb().failed('startup');
    f.stop.mockRejectedValueOnce(new Error('synthetic cleanup')); await expect(f.previews.remove(floor)).rejects.toThrow('cleanup');
    expect(f.removeDesk).not.toHaveBeenCalled(); f.removeDesk.mockRejectedValueOnce(new Error('already absent'));
    await f.previews.remove(floor); expect(f.stop).toHaveBeenCalledTimes(2);
    f.releaseDesk.mockRejectedValueOnce(new Error('synthetic discovery')); await f.previews.clearOrphans([floor]); await f.previews.close([floor]);
  });
  it.each([true, false])('does not resurrect a stopped preview after a late occupied=%s port observation', async occupied => {
    const f = fixture(); let complete!: (value: boolean) => void;
    vi.mocked(portOpen).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const started = f.previews.start(floor, 'Synthetic delayed discovery');
    await Promise.resolve(); await Promise.resolve(); await f.previews.stop(floor); complete(occupied); await started;
    expect(f.previews.view(floor)).toMatchObject({ status: 'stopped', url: null, error: null }); expect(f.start).not.toHaveBeenCalled(); await f.previews.close([floor]);
  });
  it('launches only the latest replacement when two starts wait on the same cleanup acknowledgement', async () => {
    const f = fixture(); await f.previews.start(floor, 'Initial'); let release!: () => void;
    f.stop.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const superseded = f.previews.start(floor, 'Superseded replacement'), latest = f.previews.start(floor, 'Current replacement');
    await Promise.resolve(); await Promise.resolve(); release(); await Promise.all([superseded, latest]);
    expect(f.start).toHaveBeenCalledTimes(2); expect(f.start.mock.calls[1][0]).toMatchObject({ title: 'Current replacement · main' }); await f.previews.close([floor]);
  });
});
