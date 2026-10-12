import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { acquireResourceLease } from './resourceLease.ts';

it('excludes concurrent owners, preserves live owners regardless of age, and checks tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-leases-'));
  try {
    const first = await acquireResourceLease(root, 'resource', 'first');
    await expect(acquireResourceLease(root, 'resource', 'second')).rejects.toThrow('owned by first');
    const file = path.join(root, (await fs.readdir(root))[0]);
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    record.acquiredAt = '2000-01-01'; await fs.writeFile(file, JSON.stringify(record));
    await expect(acquireResourceLease(root, 'resource', 'second')).rejects.toThrow('owned by first');
    await first.release();
    const second = await acquireResourceLease(root, 'resource', 'second');
    record.token = 'replacement'; await fs.writeFile(file, JSON.stringify(record));
    await expect(second.assertOwned()).rejects.toThrow('ownership lost');
    await expect(second.release()).rejects.toThrow('ownership lost');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).token).toBe('replacement');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('fails closed for damaged records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-leases-'));
  try {
    await acquireResourceLease(root, 'resource', 'first');
    await fs.writeFile(path.join(root, (await fs.readdir(root))[0]), '{}');
    await expect(acquireResourceLease(root, 'resource', 'second')).rejects.toThrow('Invalid resource lease');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('serializes dead-owner recovery and keeps deployment recovery manual', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-leases-'));
  try {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
    const deadPid = child.pid!;
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()); });
    await acquireResourceLease(root, 'resource', 'old owner');
    const file = path.join(root, (await fs.readdir(root))[0]);
    const record = JSON.parse(await fs.readFile(file, 'utf8')); record.pid = deadPid;
    await fs.writeFile(file, JSON.stringify(record));
    await expect(acquireResourceLease(root, 'resource', 'deployment', { reclaimDeadOwner: false })).rejects.toThrow('verify no platform operation');
    const results = await Promise.allSettled([acquireResourceLease(root, 'resource', 'first'), acquireResourceLease(root, 'resource', 'second')]);
    const acquired = results.filter((r) => r.status === 'fulfilled');
    expect(acquired).toHaveLength(1);
    await acquired[0].value.assertOwned(); await acquired[0].value.release();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
