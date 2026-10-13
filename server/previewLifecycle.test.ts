import {expect, it, vi} from 'vitest';
import {Previews, type PreviewFloor} from './previews.ts';
import type {Backend} from './backend.ts';
vi.mock('./previewRunner.ts',async original=>({...await original<typeof import('./previewRunner.ts')>(),portOpen:vi.fn(async()=>false)}));
import {portOpen} from './previewRunner.ts';
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
it('retains failed cleanup and retries the same handle before allowing replacement',async()=>{
  const stop=vi.fn().mockRejectedValueOnce(new Error('Synthetic cleanup failure')).mockResolvedValue(undefined),start=vi.fn(()=>({stop})),releaseDesk=vi.fn(async()=>{});
  const previews=new Previews({previews:{start},releaseDesk} as unknown as Backend,{emit:vi.fn(),pulls:()=>[]});
  await previews.start(floor,'Fixture');await expect(previews.stop(floor)).rejects.toThrow('cleanup');expect(previews.view(floor).status).toBe('error');expect(releaseDesk).not.toHaveBeenCalled();
  await previews.start(floor,'Replacement');expect(stop).toHaveBeenCalledTimes(2);expect(start).toHaveBeenCalledTimes(2);await previews.close([floor]);
});
it('shares reentrant/concurrent cleanup instead of losing a still-running handle',async()=>{
  let release!:()=>void;const stop=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const previews=new Previews({previews:{start:()=>({stop})},releaseDesk:async()=>{}} as unknown as Backend,{emit:vi.fn(),pulls:()=>[]});
  await previews.start(floor,'Fixture');const first=previews.stop(floor),second=previews.stop(floor);await vi.waitFor(()=>expect(stop).toHaveBeenCalledOnce());release();await Promise.all([first,second]);expect(previews.view(floor).status).toBe('stopped');
});
it('does not claim a stopped preview when its port remains occupied after cleanup',async()=>{
  vi.useFakeTimers();const stop=vi.fn(async()=>{}),releaseDesk=vi.fn(async()=>{});const previews=new Previews({previews:{start:()=>({stop})},releaseDesk} as unknown as Backend,{emit:vi.fn(),pulls:()=>[]});
  try{
    vi.mocked(portOpen).mockResolvedValue(false);await previews.start(floor,'Fixture');vi.mocked(portOpen).mockResolvedValue(true);
    const pending=expect(previews.stop(floor)).rejects.toThrow('still listening');await vi.advanceTimersByTimeAsync(6000);await pending;expect(previews.view(floor).status).toBe('error');expect(stop).toHaveBeenCalledOnce();
  }finally{vi.mocked(portOpen).mockResolvedValue(false);vi.useRealTimers();await previews.close([floor]);}
});
