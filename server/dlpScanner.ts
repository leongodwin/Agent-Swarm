import fs from 'node:fs/promises';
import path from 'node:path';
import { auditDlpCompliance, dlpResource, type DlpScanReport } from '../shared/dlp.ts';
export type { DlpScanReport } from '../shared/dlp.ts';

const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'dist-server', 'coverage']);
const limits = { depth: 32, files: 10000, fileBytes: 4 * 1024 * 1024 };

/** A bounded local heuristic, not tenant DLP certification. Incomplete reads
 * never produce a clear result. Async IO keeps the office responsive. */
export async function scanDirectoryDlp(dir: string | null, repoFullName: string, bounds = limits): Promise<DlpScanReport> {
  const report: DlpScanReport = { repoFullName, checkoutPath: dir, scannedFiles: 0, scannedPaths: [], violations: [], timestamp: new Date().toISOString(), isRealScan: false, status: 'unavailable', errors: [], scope: 'local-source-heuristic' };
  const error = (file: string, reason: string) => report.errors.push({ path: file, reason });
  if (!dir) { error('.', 'Checkout unavailable'); return report; }
  const root = path.resolve(dir);
  try { const stat = await fs.lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) { error('.', 'Checkout must be a directory without a symbolic link'); return report; } }
  catch { error('.', 'Checkout unavailable'); return report; }
  const stack = [{ directory: root, depth: 0 }];
  let candidates = 0, visited = 0;
  while (stack.length) {
    const { directory, depth } = stack.pop()!;
    const relative = (file: string) => path.relative(root, file).replace(/\\/g, '/') || '.';
    if (depth > bounds.depth) { error(relative(directory), 'Directory depth limit reached'); continue; }
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { error(relative(directory), 'Directory unreadable'); continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (excludedDirectories.has(entry.name.toLowerCase()) && entry.isDirectory()) continue;
      const full = path.join(directory, entry.name), file = relative(full);
      if (++visited > bounds.files * 4) { error(file, 'Directory entry limit reached'); stack.length = 0; break; }
      if (entry.isSymbolicLink()) { error(file, 'Symbolic link requires separate review'); continue; }
      if (entry.isDirectory()) { stack.push({ directory: full, depth: depth + 1 }); continue; }
      if (!entry.isFile() || !dlpResource(entry.name)) continue;
      if (++candidates > bounds.files) { error(file, 'File count limit reached'); stack.length = 0; break; }
      let handle;
      try {
        handle = await fs.open(full, 'r');
        const before = await handle.stat();
        if (!before.isFile() || before.size > bounds.fileBytes) { error(file, 'File size limit reached'); continue; }
        const bytes = Buffer.alloc(Math.min(before.size + 1, bounds.fileBytes + 1));
        let read = 0;
        while (read < bytes.length) { const result = await handle.read(bytes, read, bytes.length - read, read); if (!result.bytesRead) break; read += result.bytesRead; }
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || read !== before.size) { error(file, 'File changed during scan'); continue; }
        const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read));
        report.violations.push(...auditDlpCompliance(content, file));
        report.scannedPaths.push(file); report.scannedFiles++;
      } catch { error(file, 'File unreadable or not valid UTF-8'); }
      finally { await handle?.close(); }
    }
  }
  report.isRealScan = report.scannedFiles > 0;
  report.status = report.errors.length ? 'incomplete' : report.violations.length ? 'blocked' : report.isRealScan ? 'clear' : 'unavailable';
  return report;
}
