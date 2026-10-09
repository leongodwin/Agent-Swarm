import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Swarm } from './swarm.ts';
import { generateHld } from './hldAgent.ts';
import { atomicWrite, SerialWriter } from './atomicFile.ts';
import { auditDlpCompliance, auditPrDiff } from '../shared/dlp.ts';
import { parseBody, hldSchema, proposalSchema } from './requestSchemas.ts';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); });
async function temp() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-review-')); dirs.push(dir); return dir; }

describe('Review regressions', () => {
  it('blocks an unavailable DLP scan without merging', async () => {
    const mergePull = vi.fn(); const mergeNote = vi.fn((_rec: unknown, _note: string) => false);
    const fake = { backend: { prFiles: vi.fn(async () => { throw new Error('offline'); }), mergePull }, mergeNote };
    const advance = (Swarm.prototype as unknown as { advanceMerge(...args: unknown[]): Promise<boolean> }).advanceMerge;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await advance.call(fake, { fullName: 'test/repo' }, {}, { number: 1, headSha: 'abc' }); }
    finally { warn.mockRestore(); }
    expect(mergePull).not.toHaveBeenCalled(); expect(mergeNote.mock.calls[0][1]).toContain('DLP scan unavailable');
  });
  it('requires QA again after updating the PR branch, including concurrent new commits', async () => {
    vi.useFakeTimers();
    const mergePull = vi.fn(); const setQa = vi.fn(); const prDetails = vi.fn(async () => ({ headSha: 'concurrent-new-commit' }));
    const fake = { backend: { prFiles: async () => [], updateBranch: vi.fn(async () => {}), mergePull, prDetails }, setQa, mergeNote: vi.fn(), schedule: vi.fn() };
    const advance = (Swarm.prototype as unknown as { advanceMerge(...args: unknown[]): Promise<boolean> }).advanceMerge;
    try {
      await advance.call(fake, { fullName: 'test/repo', defaultBranch: 'main' }, { passedSha: 'abc', round: 1, retests: 0, mergeFixes: 0 },
        { number: 1, headSha: 'abc', mergeable: 'MERGEABLE', mergeState: 'BEHIND', checks: 'passing', isDraft: false });
      expect(mergePull).not.toHaveBeenCalled(); expect(setQa.mock.calls[0][1]).toMatchObject({ status: 'queued', passedSha: null, testedSha: null, round: 2 });
      expect(prDetails).not.toHaveBeenCalled();
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });
  it('detects authentication changes with unchanged diff context and reordered JSON keys', () => {
    const diff = 'diff --git a/Workflows/f.json b/Workflows/f.json\n--- a/Workflows/f.json\n+++ b/Workflows/f.json\n@@ -1,3 +1,3 @@\n "authentication": {\n- "type": "ActiveDirectoryOAuth"\n+ "type": "None"\n }';
    expect(auditPrDiff(diff).some((violation) => violation.id.includes('anon_http'))).toBe(true);
    expect(auditDlpCompliance('{"authentication":{"extra":true,"type":"None"}}')).toHaveLength(1);
  });
  it('actually writes the HLD and propagates disk failure', async () => {
    const dir = await temp(); const input = { solutionName: 'Test', problemContext: 'Problem', components: [], repoPath: dir };
    const result = await generateHld(input); expect(await fs.readFile(result.savedFilePath!, 'utf8')).toBe(result.markdownContent);
    await expect(generateHld({ ...input, repoPath: path.join(dir, 'missing') })).rejects.toThrow();
    expect(() => parseBody(hldSchema, { ...input, repoPath: 'arbitrary' })).toThrow();
    expect(() => parseBody(proposalSchema, { title: 'Missing fields' })).toThrow();
  });
  it('rejects HLD directories escaping the checkout through a junction or symlink', async () => {
    const root = await temp(); const outside = await temp();
    await fs.symlink(outside, path.join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(generateHld({ solutionName: 'Test', problemContext: 'Problem', components: [], repoPath: root })).rejects.toThrow('inside the repository');
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it('serializes concurrent atomic writes without losing the latest value', async () => {
    const dir = await temp(); const file = path.join(dir, 'state.json'); const writer = new SerialWriter();
    await Promise.all(Array.from({ length: 20 }, (_, index) => writer.write(() => atomicWrite(file, JSON.stringify({ index })))));
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ index: 19 });
    expect(await fs.readdir(dir)).toEqual(['state.json']);
  });
});
