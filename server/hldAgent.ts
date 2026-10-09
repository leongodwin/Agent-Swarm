import fs from 'node:fs/promises';
import path from 'node:path';
import { generateHldContent, type HldInput, type HldResult } from '../shared/hld.ts';
import { atomicWrite } from './atomicFile.ts';
import { HttpError } from './httpError.ts';
export * from '../shared/hld.ts';

/** Only server-resolved checkout paths may reach this function. */
export async function generateHld(input: HldInput): Promise<HldResult> {
  const result = generateHldContent(input);
  if (!input.repoPath) return result;
  const root = await fs.realpath(input.repoPath);
  let dir = root;
  for (const segment of ['docs', 'architecture']) {
    dir = path.join(dir, segment);
    await fs.mkdir(dir, { recursive: true });
    const resolved = await fs.realpath(dir);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(400, 'Architecture directory must stay inside the repository');
    dir = resolved;
  }
  result.savedFilePath = path.join(dir, 'HLD.md');
  await atomicWrite(result.savedFilePath, result.markdownContent);
  return result;
}
