import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Queue writes per owner; snapshots are captured after the previous write finishes. */
export class SerialWriter {
  private pending: Promise<unknown> = Promise.resolve();
  write<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => undefined).then(fn);
    this.pending = next;
    return next;
  }
  drain() { return this.pending; }
}
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(tmp, file); break; }
      catch (err) {
        if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } finally { await fs.rm(tmp, { force: true }).catch(() => undefined); }
}
