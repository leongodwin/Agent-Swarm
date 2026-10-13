import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {readOfficeState} from './officeState.ts';
const roots: string[] = [];
afterEach(async () => {vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, {recursive: true, force: true});});
async function fixture(raw = '{}') {const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-state-read-')); roots.push(root); const file = path.join(root, 'state.json'); await fs.writeFile(file, raw); return file;}

it('rejects unreadable state rather than interpreting it as a new office', async () => {
  const file = await fixture('{"version":2}');
  const handle=await fs.open(file,'r');vi.spyOn(fs,'open').mockResolvedValueOnce(handle);
  const read = vi.spyOn(handle, 'read').mockRejectedValueOnce(Object.assign(new Error('permission denied'), {code: 'EACCES'}));
  await expect(readOfficeState(file)).rejects.toThrow('preserve and repair'); read.mockRestore();
  expect(await fs.readFile(file, 'utf8')).toBe('{"version":2}');
});
it('rejects a file that disappears after discovery', async () => {
  const file = await fixture();
  const handle=await fs.open(file,'r');const original=handle.read.bind(handle);vi.spyOn(fs,'open').mockResolvedValueOnce(handle);
  vi.spyOn(handle,'read').mockImplementationOnce(async(...args:any[])=>{await fs.unlink(file);return (original as any)(...args);});
  await expect(readOfficeState(file)).rejects.toThrow('preserve and repair');
  expect(await fs.stat(file).then(()=>true,()=>false)).toBe(false);
});
it('rejects directories and oversized state without consuming their contents', async () => {
  const file = await fixture(); await fs.truncate(file, 17 * 1024 * 1024);
  const handle=await fs.open(file,'r');vi.spyOn(fs,'open').mockResolvedValueOnce(handle);const read=vi.spyOn(handle,'read');
  await expect(readOfficeState(file)).rejects.toThrow('preserve and repair');
  await expect(readOfficeState(path.dirname(file))).rejects.toThrow('preserve and repair');
  expect(read).not.toHaveBeenCalled();
});
it('preserves backward-compatible data while rejecting duplicate agent identities', async () => {
  const file = await fixture(JSON.stringify({version: 1, settings: {futureSetting: 'keep'}, futureRoot: 'keep', agents: [{id: 'x', name: 'X', repoId: '', status: 'idle'}]}));
  expect(await readOfficeState(file)).toMatchObject({futureRoot: 'keep', settings: {futureSetting: 'keep'}});
  await fs.writeFile(file, JSON.stringify({agents: Array(2).fill({id: 'x', name: 'X', repoId: '', status: 'idle'})}));
  await expect(readOfficeState(file)).rejects.toThrow('preserve and repair');
});
