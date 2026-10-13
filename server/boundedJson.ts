import fs from 'node:fs/promises';

/** Missing means first run only when opening the file fails with ENOENT.
 * Read at most the observed size plus one byte; changed/unreadable files are errors. */
export async function readBoundedText(file: string, maximum = 16 * 1024 * 1024): Promise<string|undefined> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64 * 1024 * 1024) throw new Error('Invalid JSON read limit');
  const handle = await fs.open(file, 'r').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!handle) return undefined;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) throw new Error('Invalid or oversized JSON file');
    const buffer = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    const current = await fs.stat(file);
    if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw new Error('JSON file changed during the read');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
  } finally { await handle.close(); }
}
export async function readBoundedJson(file:string,maximum=16*1024*1024):Promise<unknown>{
  const text=await readBoundedText(file,maximum);return text===undefined?undefined:JSON.parse(text);
}
