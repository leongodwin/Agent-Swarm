import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { CanvasOwnership, canvasResource } from './canvasOwnership.ts';
import { acquireResourceLease } from './resourceLease.ts';
it('blocks deployment while an editor owns the app and permits token release after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-owner-'));
  try {
    const before = new CanvasOwnership(root), after = new CanvasOwnership(root);
    const owned = await before.acquire('https://target.crm.dynamics.com/', 'app', 'ada');
    await expect(acquireResourceLease(root, canvasResource('https://target.crm.dynamics.com', 'app'), 'release')).rejects.toThrow('owned by ada');
    await expect(after.release('wrong')).rejects.toThrow('Unknown');
    await after.release(owned.token);
    const deployment = await acquireResourceLease(root, canvasResource('https://target.crm.dynamics.com', 'app'), 'release'); await deployment.release();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
