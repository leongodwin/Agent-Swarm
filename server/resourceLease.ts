import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

interface Record { resource: string; owner: string; pid: number; token: string; acquiredAt: string }
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };

/** Local-machine coordination. A live owner is never displaced by a timeout. */
export async function acquireResourceLease(root: string, resource: string, owner: string, options: { reclaimDeadOwner?: boolean } = {}) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${crypto.createHash('sha256').update(resource).digest('hex')}.json`);
  const guard = `${file}.reaping`;
  const record: Record = { resource, owner, pid: process.pid, token: crypto.randomUUID(), acquiredAt: new Date().toISOString() };
  const read = async () => {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Record;
    if (!Number.isInteger(value.pid) || value.pid <= 0 || !value.token || value.resource !== resource) throw new Error(`Invalid resource lease: ${file}; inspect it before recovery`);
    return value;
  };
  const create = async () => {
    const handle = await fs.open(file, 'wx');
    try { await handle.writeFile(JSON.stringify(record)); } finally { await handle.close(); }
  };
  try { await create(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await read();
    if (alive(previous.pid)) throw new Error(`Resource ${resource} is owned by ${previous.owner} (PID ${previous.pid})`);
    if (options.reclaimDeadOwner === false) throw new Error(`Resource ${resource} has interrupted owner ${previous.owner}; verify no platform operation is still running before clearing ${file}`);
    // Serialize reclaimers, then reread: another process may have acquired the resource.
    await fs.mkdir(guard).catch(() => { throw new Error(`Resource recovery already in progress: ${guard}`); });
    try {
      const current = await read().catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
      if (current && (current.token !== previous.token || alive(current.pid))) throw new Error(`Resource ${resource} changed owner during recovery`);
      if (current) await fs.unlink(file);
      await create();
    } finally { await fs.rmdir(guard); }
  }
  let released = false;
  const assertOwned = async () => {
    if (released || (await read()).token !== record.token) throw new Error(`Resource ownership lost: ${resource}`);
  };
  return {
    token: record.token, assertOwned,
    async release() { if (released) return; await assertOwned(); await fs.unlink(file); released = true; },
  };
}

export async function withResourceLease<T>(root: string, resource: string, owner: string, fn: (lease: Awaited<ReturnType<typeof acquireResourceLease>>) => Promise<T>): Promise<T> {
  const lease = await acquireResourceLease(root, resource, owner);
  try { return await fn(lease); } finally { await lease.release(); }
}
