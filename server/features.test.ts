import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureStore } from './features.ts';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); });
async function store(demo = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-features-')); dirs.push(dir);
  const send = vi.fn<typeof fetch>(async () => new Response('', { status: 200 }));
  const file = path.join(dir, 'state.json'); const service = new FeatureStore(file, demo, 'https://example.com/webhook', send);
  await service.init(); return { service, send, file };
}
describe('Scoped feature state', () => {
  it('persists resubmissions and isolates repositories across restart', async () => {
    const { service, file } = await store();
    const initial = service.runs('repo-a');
    const resubmitted = await service.resubmit('repo-a', initial[0].id);
    expect(resubmitted.simulated).toBe(true); expect(service.runs('repo-b')).toHaveLength(initial.length);
    const restarted = new FeatureStore(file, true); await restarted.init();
    expect(restarted.runs('repo-a')[0].id).toBe(resubmitted.resubmitted.id);
    await expect(restarted.resubmit('repo-a', 'missing')).rejects.toThrow('not found');
  });
  it('keeps simulation announcements local and restores actual previous release history', async () => {
    const { service, send, file } = await store(false);
    const before = service.pipeline('repo-a'); await service.release('repo-a', 'approve', 'Ada');
    expect(send).not.toHaveBeenCalled(); expect(service.feed('repo-a')[0].title).toContain('Simulation:');
    expect(service.feed('repo-b')).toEqual([]);
    const restarted = new FeatureStore(file, false); await restarted.init();
    expect((await restarted.release('repo-a', 'rollback')).currentProdVersion).toBe(before.currentProdVersion);
  });
  it('does not send demo notifications and checks real webhook rejection', async () => {
    const demo = await store(); await demo.service.notify('a', { title: 'Demo', subtitle: '', summary: '' });
    expect(demo.send).not.toHaveBeenCalled();
    const real = await store(false); real.send.mockResolvedValue(new Response('', { status: 403 }));
    await expect(real.service.notify('a', { title: 'Real', subtitle: '', summary: '' })).rejects.toThrow('Teams rejected');
    expect(real.service.feed('a')).toEqual([]);
  });
  it('restores in-memory state when persistence fails', async () => {
    const { service, file } = await store();
    const runs = service.runs('repo-a');
    const pipeline = service.pipeline('repo-a');
    await fs.mkdir(file);
    await expect(service.resubmit('repo-a', runs[0].id)).rejects.toThrow();
    expect(service.runs('repo-a')).toEqual(runs);
    await expect(service.release('repo-a', 'approve')).rejects.toThrow();
    expect(service.pipeline('repo-a')).toEqual(pipeline);
    expect(service.feed('repo-a')).toEqual([]);
  });

});
