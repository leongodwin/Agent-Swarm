import { expect, it, vi } from 'vitest';
import { OfficeShutdown } from './officeShutdown.ts';

it('closes every service immediately even when earlier cleanup hangs or throws', async () => {
  let release!: () => void;
  const slow = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const broken = vi.fn(() => { throw new Error('provider failure'); });
  const cancelled = vi.fn(async () => {});
  const lifecycle = new OfficeShutdown([{ name: 'slow', close: slow }, { name: 'broken', close: broken }, { name: 'worker', close: cancelled }]);
  const work = lifecycle.close(true);
  expect(lifecycle.closed).toBe(true);
  expect(cancelled).toHaveBeenCalledExactlyOnceWith(true);
  expect(lifecycle.close(false)).toBe(work);
  release();
  await expect(work).rejects.toThrow('Office shutdown did not complete cleanly');
  expect(slow).toHaveBeenCalledOnce(); expect(broken).toHaveBeenCalledOnce();
});

it('reserves shutdown identity before a provider reenters and preserves the first restart decision', async () => {
  let reentered: Promise<void> | undefined;
  const calls: boolean[] = [];
  const lifecycle = new OfficeShutdown([{ name: 'reentrant', close: restart => {
    calls.push(restart); reentered = lifecycle.close(false);
  } }, { name: 'next', close: restart => { calls.push(restart); } }]);
  const work = lifecycle.close(true);
  expect(reentered).toBe(work); await work;
  expect(calls).toEqual([true, true]);
});

it('reports all rejected providers and waits for every cleanup to settle', async () => {
  let release!: () => void;
  const lifecycle = new OfficeShutdown([
    { name: 'first', close: async () => { throw new Error('first failure'); } },
    { name: 'second', close: () => new Promise<void>(resolve => { release = resolve; }) },
    { name: 'third', close: async () => { throw new Error('third failure'); } },
  ]);
  let settled = false;
  const result = lifecycle.close().catch(error => { settled = true; return error; });
  await Promise.resolve(); expect(settled).toBe(false);
  release(); const error = await result;
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors.map((entry: Error) => entry.message)).toEqual(['first cleanup failed', 'third cleanup failed']);
});

it('settles an empty shutdown and successful synchronous providers', async () => {
  await expect(new OfficeShutdown([]).close()).resolves.toBeUndefined();
  await expect(new OfficeShutdown([{ name: 'sync', close: () => {} }]).close()).resolves.toBeUndefined();
});
