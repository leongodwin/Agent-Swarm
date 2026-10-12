import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { templateCatalog, templateFiles, installTemplate, type TemplateId } from './implementationTemplates.ts';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
it('installs every versioned starter with reproducible hashes and no tenant-verification claims', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-template-')); dirs.push(root);
  await fs.writeFile(path.join(root, 'README.md'), 'Existing project');
  for (const item of templateCatalog()) {
    const result = await installTemplate(root, item.id as TemplateId);
    const lock = JSON.parse(await fs.readFile(path.join(result.directory, 'template-lock.json'), 'utf8'));
    for (const [name, hash] of Object.entries(lock.hashes)) expect(crypto.createHash('sha256').update(await fs.readFile(path.join(result.directory, name))).digest('hex')).toBe(hash);
    expect(result.tenantVerified).toBe(false);
    expect(JSON.parse(await fs.readFile(path.join(result.directory, 'recipe.json'), 'utf8')).steps.length).toBe(4);
    expect(() => execFileSync(process.execPath, [path.join(result.directory, 'scripts/pack.mjs')], { cwd: result.directory, stdio: 'pipe' })).toThrow();
  }
  expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('Existing project');
});
it('rejects unknown platform and traversal requests', () => {
  for (const id of ['../../elsewhere', '__proto__', 'unknown']) expect(() => templateFiles(id as TemplateId)).toThrow('Unknown');
});
