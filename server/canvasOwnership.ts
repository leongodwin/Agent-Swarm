import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireResourceLease } from './resourceLease.ts';
import { HttpError } from './httpError.ts';

export const canvasResource = (environment: string, appId: string) => `canvas-authoring:${new URL(environment).origin.toLowerCase()}:${appId.toLowerCase()}`;
/** Coordinates local authoring and deployment; does not override a remote Studio editing lock. */
export class CanvasOwnership {
  private leases = new Map<string, Awaited<ReturnType<typeof acquireResourceLease>>>();
  constructor(private root: string) {}
  async acquire(environment: string, appId: string, owner: string) {
    const lease = await acquireResourceLease(this.root, canvasResource(environment, appId), owner, { reclaimDeadOwner: false }).catch((error: Error) => { throw new HttpError(409, error.message); });
    const token = lease.token;
    this.leases.set(token, lease); return { token, owner, appId, environment, remoteStudioUnlock: false };
  }
  async release(token: string) {
    const lease = this.leases.get(token);
    if (lease) { await lease.release(); this.leases.delete(token); return; }
    // A restart loses in-memory handles, not ownership. Only the original opaque
    // token can release its persisted Canvas lease; never displace another owner.
    for (const name of await fs.readdir(this.root).catch(() => [])) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(this.root, name);
      const record = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (record?.token !== token || !String(record.resource).startsWith('canvas-authoring:')) continue;
      const guard = `${file}.reaping`; await fs.mkdir(guard);
      try {
        const current = JSON.parse(await fs.readFile(file, 'utf8'));
        if (current.token !== token) throw new Error('Authoring ownership changed');
        await fs.unlink(file); return;
      } finally { await fs.rmdir(guard); }
    }
    throw new HttpError(409, 'Unknown authoring lease token; inspect interrupted ownership rather than forcing a remote unlock');
  }
  async close() { for (const token of [...this.leases.keys()]) await this.release(token); }
}
