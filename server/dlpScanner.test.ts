import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { scanDirectoryDlp } from './dlpScanner.ts';

const roots: string[] = [];
const bounds = { depth: 32, files: 10000, fileBytes: 4 * 1024 * 1024 };
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-dlp-complete-')); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

it('distinguishes missing and empty checkouts from a completed clear scan', async () => {
  expect((await scanDirectoryDlp(null, 'repo')).status).toBe('unavailable');
  expect((await scanDirectoryDlp(path.join(os.tmpdir(), 'not-a-checkout-'+Date.now()), 'repo')).errors).toHaveLength(1);
  const root = await fixture();
  expect((await scanDirectoryDlp(root, 'repo')).status).toBe('unavailable');
  await fs.writeFile(path.join(root, 'safe.cjs'), '{}');
  const report = await scanDirectoryDlp(root, 'repo');
  expect(report).toMatchObject({ status: 'clear', scope: 'local-source-heuristic', scannedFiles: 1, errors: [] });
  expect(report.scannedPaths).toEqual(['safe.cjs']);
});
it('scans hidden configuration directories and detects blocked integrations at depth beyond the old limit', async () => {
  const root = await fixture(), directory = path.join(root, '.config', ...Array(8).fill('nested'));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'flow.json'), '{"connector":"shared_dropbox"}');
  const report = await scanDirectoryDlp(root, 'repo');
  expect(report.status).toBe('blocked'); expect(report.violations[0].resourceFile).toContain('.config/');
  expect(report.scannedFiles).toBe(1);
});
it('reports traversal and file limits as incomplete instead of clear', async () => {
  const root = await fixture();await fs.mkdir(path.join(root,'nested'));
  await fs.writeFile(path.join(root,'safe.json'),'{}');await fs.writeFile(path.join(root,'nested','unsafe.yaml'),'connector: shared_dropbox');
  expect((await scanDirectoryDlp(root,'repo',{...bounds,depth:0})).errors[0].reason).toContain('depth limit');
  const limited=await scanDirectoryDlp(root,'repo',{...bounds,files:1});
  expect(limited.status).toBe('incomplete');expect(limited.errors[0].reason).toContain('count limit');
  const large=await scanDirectoryDlp(root,'repo',{...bounds,fileBytes:1});
  expect(large.status).toBe('incomplete');expect(large.scannedFiles).toBe(0);
});
it('retains partial progress and diagnostics when a candidate cannot be read', async () => {
  const root = await fixture();await fs.writeFile(path.join(root,'a-safe.json'),'{}');await fs.writeFile(path.join(root,'b-unreadable.json'),'{}');
  const original=fs.open.bind(fs);
  vi.spyOn(fs,'open').mockImplementation(async (...args) => { if(String(args[0]).endsWith('b-unreadable.json'))throw new Error('EACCES secret path');return original(...args); });
  const report=await scanDirectoryDlp(root,'repo');
  expect(report).toMatchObject({status:'incomplete',scannedFiles:1,isRealScan:true});
  expect(report.errors).toEqual([{path:'b-unreadable.json',reason:'File unreadable or not valid UTF-8'}]);
});
it('cannot clear a scan after unreadable directories or invalid text', async () => {
  const root=await fixture();await fs.mkdir(path.join(root,'nested'));await fs.writeFile(path.join(root,'broken.json'),Buffer.from([0xff,0xfe]));
  const original=fs.readdir.bind(fs);
  vi.spyOn(fs,'readdir').mockImplementation(async (...args) => { if(String(args[0]).endsWith('nested'))throw new Error('EACCES');return original(...args); });
  const report=await scanDirectoryDlp(root,'repo');expect(report.status).toBe('incomplete');expect(report.errors).toHaveLength(2);
});
it('does not silently skip symbolic links or follow them into another checkout', async () => {
  const root=await fixture(),external=await fixture();await fs.writeFile(path.join(external,'unsafe.json'),'{"connector":"shared_dropbox"}');
  await fs.symlink(external,path.join(root,'linked'),'junction');
  const report=await scanDirectoryDlp(root,'repo');expect(report.status).toBe('incomplete');expect(report.scannedFiles).toBe(0);expect(report.errors[0].reason).toContain('Symbolic link');
  expect((await scanDirectoryDlp(path.join(root,'linked'),'repo')).status).toBe('unavailable');
});
it('refuses files that change during the read and closes the descriptor', async () => {
  const root=await fixture();await fs.writeFile(path.join(root,'changing.json'),'{}');
  const original=fs.open.bind(fs);let closed=false;
  vi.spyOn(fs,'open').mockImplementation(async (...args) => {
    const handle=await original(...args),stat=handle.stat.bind(handle),close=handle.close.bind(handle);let calls=0;
    vi.spyOn(handle,'stat').mockImplementation(async () => { const result=await stat();if(++calls>1)result.mtimeMs++;return result; });
    vi.spyOn(handle,'close').mockImplementation(async () => {closed=true;await close();});return handle;
  });
  const report=await scanDirectoryDlp(root,'repo');
  expect(report.status).toBe('incomplete');expect(report.errors[0].reason).toBe('File changed during scan');expect(closed).toBe(true);
});
it('bounds traversal even when files have no policy-scannable extensions and explicitly excludes generated dependencies', async () => {
  const root=await fixture();await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules','blocked.json'),'{"connector":"shared_dropbox"}');
  await fs.writeFile(path.join(root,'safe.json'),'{}');
  expect((await scanDirectoryDlp(root,'repo')).status).toBe('clear');
  for(let i=0;i<5;i++)await fs.writeFile(path.join(root,`${i}.txt`),'text');
  const report=await scanDirectoryDlp(root,'repo',{...bounds,files:1});expect(report.status).toBe('incomplete');expect(report.errors[0].reason).toBe('Directory entry limit reached');
});
