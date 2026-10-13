import {expect, it, vi} from 'vitest';
import {Previews, type PreviewFloor} from './previews.ts';
import type {Backend} from './backend.ts';
const floor: PreviewFloor = {id: 'synthetic', fullName: 'synthetic/repo', defaultBranch: 'main', floor: 1, preview: {command: null, env: {}}};
it('blocks a preview whose PR check completes after office shutdown', async () => {
  let resolve!: (value: {state: string}) => void;
  const start = vi.fn();
  const backend = {prDetails: () => new Promise(done => {resolve = done;}), previews: {start}};
  const previews = new Previews(backend as unknown as Backend, {emit: vi.fn(), pulls: () => []});
  const pending = previews.start(floor, 'Synthetic preview', 1);
  await previews.close([floor]); resolve({state: 'OPEN'});
  await expect(pending).rejects.toThrow('closed');
  await expect(previews.start(floor, 'Synthetic preview')).rejects.toThrow('closed');
  expect(start).not.toHaveBeenCalled();
});
it('discards a late default-preview observation after closing', async () => {
  let resolve!: (value: boolean) => void; const emit = vi.fn();
  const previews = new Previews({previews: {hasDefault: () => new Promise(done => {resolve = done;})}} as unknown as Backend, {emit, pulls: () => []});
  const pending = previews.refreshDefault(floor); await previews.close([floor]); resolve(true); await pending;
  expect(emit).not.toHaveBeenCalled();
});
