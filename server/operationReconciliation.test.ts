import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reconcile } from './operationReconciliation.ts';
import type { DeliveryRun } from '../shared/delivery.ts';

const state = (): DeliveryRun => ({ id: 'run', repoId: 'repo', head: 'commit', environmentUrl: 'https://target.crm4.dynamics.com', phase: 'deploying', startedAt: new Date().toISOString(), appUrls: [], evidence: [], log: [] });
const owned = async () => {};
it('denies an overlapping retry before another read or intent and later reconciles without duplicating the mutation',async()=>{
  const run=state();let release!:(value:boolean)=>void,applied=false;const firstRead=new Promise<boolean>(resolve=>{release=resolve;});
  const observe=vi.fn(async()=>observe.mock.calls.length===1?firstRead:applied),mutate=vi.fn(async()=>{applied=true;}),save=vi.fn(async()=>{});
  const first=reconcile('enable',{},run,save,owned,observe,mutate);await vi.waitFor(()=>expect(observe).toHaveBeenCalledOnce());
  await expect(reconcile('enable',{},run,save,owned,observe,mutate)).rejects.toThrow('already in progress');expect(observe).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
  release(false);await first;await reconcile('enable',{},run,save,owned,observe,mutate);
  expect(mutate).toHaveBeenCalledOnce();expect(run.operations).toHaveLength(1);expect(run.operations![0].status).toBe('verified');
});
it('releases its in-flight guard after a failed read without suppressing a later observation',async()=>{
  const run=state(),mutate=vi.fn(async()=>{}),observe=vi.fn(async()=>{throw new Error('read unavailable');});
  await expect(reconcile('enable',{},run,async()=>{},owned,observe,mutate)).rejects.toThrow('read unavailable');
  await reconcile('enable',{},run,async()=>{},owned,async()=>true,mutate);expect(mutate).not.toHaveBeenCalled();expect(run.operations![0].status).toBe('verified');
});
it('keeps different operations independent while one observation is pending',async()=>{
  const run=state();let release!:(value:boolean)=>void;const pending=new Promise<boolean>(resolve=>{release=resolve;});
  const first=reconcile('first',{},run,async()=>{},owned,()=>pending,async()=>{});
  await reconcile('second',{},run,async()=>{},owned,async()=>true,async()=>{});release(true);await first;
  expect(run.operations?.map(operation=>operation.id).sort()).toEqual(['first','second']);
});
it.each(['drift', 'read failure'] as const)('persists invalidation before %s and recovers by observation after restart without repeating mutation', async failure => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-reconcile-'));
  const file = path.join(home, 'release.json');
  let run = state();
  const save = async () => { await fs.writeFile(file, JSON.stringify(run)); };
  const mutation = vi.fn(async () => {});
  try {
    await reconcile('enable', { flow: 'flow' }, run, save, owned, async () => true, mutation);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).operations[0].status).toBe('verified');
    await expect(reconcile('enable', { flow: 'flow' }, run, save, owned, async () => {
      expect(JSON.parse(await fs.readFile(file, 'utf8')).operations[0].status).toBe('unknown');
      if (failure === 'read failure') throw new Error('read failed');
      return false;
    }, mutation)).rejects.toThrow(failure === 'drift' ? 'observed drift' : 'read failed');
    run = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(run.operations![0].status).toBe('unknown');
    await reconcile('enable', { flow: 'flow' }, run, save, owned, async () => true, mutation);
    expect(run.operations![0].status).toBe('verified');
    expect(mutation).not.toHaveBeenCalled();
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
it.each(['before mutation', 'after mutation', 'after observation'] as const)('revokes ownership %s without reporting success or writing as a stale owner', async point => {
  const run = state(); let owns = true, reads = 0;
  const assertOwned = async () => { if (!owns) throw new Error('ownership lost'); };
  const save = vi.fn(async () => { if (point === 'before mutation' && run.operations?.[0].status === 'intent') owns = false; });
  const observe = vi.fn(async () => { reads++; if (reads === 2 && point === 'after observation') owns = false; return reads === 2; });
  const mutate = vi.fn(async () => { if (point === 'after mutation') owns = false; });
  await expect(reconcile('enable', {}, run, save, assertOwned, observe, mutate)).rejects.toThrow('ownership lost');
  expect(run.operations![0].status).toBe('intent');
  expect(save).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledTimes(point === 'before mutation' ? 0 : 1);
  expect(observe).toHaveBeenCalledTimes(point === 'after observation' ? 2 : 1);
});
it('does not certify an already satisfied state when ownership is lost during its read', async () => {
  const run = state(); let owns = true;
  const save = vi.fn(async () => {}), mutate = vi.fn(async () => {});
  await expect(reconcile('enable', {}, run, save, async () => { if (!owns) throw new Error('ownership lost'); }, async () => { owns = false; return true; }, mutate)).rejects.toThrow('ownership lost');
  expect(run.operations).toEqual([]); expect(save).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
});
it('rejects duplicate operation history and changed definitions before observing or mutating', async () => {
  const run = state(); const observe = vi.fn(async () => true), mutate = vi.fn(async () => {});
  await reconcile('enable', { target: 'a' }, run, async () => {}, owned, observe, mutate);
  observe.mockClear();
  await expect(reconcile('enable', { target: 'b' }, run, async () => {}, owned, observe, mutate)).rejects.toThrow('create a new release');
  run.operations!.push({ ...run.operations![0] });
  await expect(reconcile('enable', { target: 'a' }, run, async () => {}, owned, observe, mutate)).rejects.toThrow('ambiguous');
  expect(observe).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
});
