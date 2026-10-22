import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: native.spawn, execFile: native.execFile }));
vi.mock('./tenancy.ts', () => ({ resolveTenancyCommand: (executable: string) => ({ file: executable, args: [] }) }));
import { deliveryCommands } from './delivery.ts';

beforeEach(() => { vi.useFakeTimers(); native.spawn.mockReset(); native.execFile.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture(pid: number | undefined = 12345) {
  const child = Object.assign(new EventEmitter(), { pid, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  native.spawn.mockReturnValue(child); const controller = new AbortController();
  const run = (executable = 'synthetic') => deliveryCommands.run({ executable, args: ['--literal', 'a b'] }, 'synthetic cwd', { SYNTHETIC: 'yes' }, controller.signal);
  return { child, controller, run };
}
it('does not launch commands whose reservation was already cancelled', async () => {
  const f = fixture(); f.controller.abort(); await expect(f.run()).rejects.toThrow('cancelled'); expect(native.spawn).not.toHaveBeenCalled();
});
it('preserves argument boundaries, hidden windows and streaming UTF8 without invoking a process', async () => {
  const f = fixture(), pending = f.run(); const utf8 = Buffer.from('a £ result'); f.child.stdout.emit('data', utf8.subarray(0, 3)); f.child.stdout.emit('data', utf8.subarray(3)); f.child.stderr.emit('data', Buffer.from('nonfatal warning')); f.child.emit('close', 0);
  await expect(pending).resolves.toBe('a £ result'); expect(native.spawn).toHaveBeenCalledWith('synthetic', ['--literal', 'a b'], expect.objectContaining({ cwd: 'synthetic cwd', windowsHide: true, env: expect.objectContaining({ SYNTHETIC: 'yes' }) }));
});
it('surfaces spawn failures without a native process id and clears timeout ownership', async () => {
  const f = fixture(undefined), pending = expect(f.run()).rejects.toThrow('synthetic spawn unavailable');
  Object.assign(f.child, { pid: undefined }); f.child.emit('error', new Error('synthetic spawn unavailable')); await pending; expect(vi.getTimerCount()).toBe(0);
});
it.each([1, null])('rejects native exit code %s using bounded stderr diagnostics', async code => {
  const f = fixture(), pending = expect(f.run()).rejects.toThrow('synthetic diagnostic'); f.child.stderr.emit('data', Buffer.from('synthetic diagnostic')); f.child.emit('close', code); await pending;
});
it('rejects PAC stdout failures even with exit zero while allowing non-PAC fixture output', async () => {
  let f = fixture(), pending = expect(f.run('pac')).rejects.toThrow('Error: denied'); f.child.stdout.emit('data', Buffer.from('Error: denied')); f.child.emit('close', 0); await pending;
  f = fixture(); const allowed = f.run('node'); f.child.stdout.emit('data', Buffer.from('Error: expected synthetic output')); f.child.emit('close', 0); await expect(allowed).resolves.toContain('expected');
});
it.each(['invalid-chunk', 'invalid-tail', 'oversized', 'abort', 'timeout', 'process-error'] as const)('holds native outcome until cleanup acknowledgement after %s', async mode => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'linux' });
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true); const f = fixture(); let settled = false;
  const result = f.run().finally(() => { settled = true; }); const failure = expect(result).rejects.toThrow(mode === 'oversized' ? 'exceeded its limit' : mode === 'abort' ? 'cancelled' : mode === 'timeout' ? 'timed out' : mode === 'process-error' ? 'failed before exit acknowledgement' : 'invalid UTF-8');
  try {
    if (mode === 'invalid-chunk') f.child.stdout.emit('data', Buffer.from([0xff]));
    if (mode === 'invalid-tail') f.child.stderr.emit('data', Buffer.from([0xc2]));
    if (mode === 'oversized') f.child.stdout.emit('data', Buffer.alloc(8 * 1024 * 1024 + 1));
    if (mode === 'abort') { f.controller.abort(); f.child.stdout.emit('data', Buffer.from('ignored after abort')); }
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(20 * 60000);
    if (mode === 'process-error') f.child.emit('error', new Error('native stream error'));
    await Promise.resolve(); expect(settled).toBe(false);
    f.child.emit('close', 0); await failure;
    if (mode !== 'invalid-tail') expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  } finally { Object.defineProperty(process, 'platform', descriptor); }
});
it('reports unverified Windows process-tree cleanup even if the root fallback exits', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'win32' });
  native.execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error('synthetic tree cleanup failure')));
  const f = fixture(), failed = expect(f.run()).rejects.toThrow('process-tree cleanup is unverified');
  try { f.controller.abort(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); f.child.emit('close', 0); await failed; expect(native.execFile).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'], { windowsHide: true }, expect.any(Function)); expect(f.child.kill).toHaveBeenCalledOnce(); }
  finally { Object.defineProperty(process, 'platform', descriptor); }
});
