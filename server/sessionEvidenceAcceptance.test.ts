import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SessionEvidence, readSessionAttempts, summarizeSessionEvidence } from './sessionEvidence.ts';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true, maxRetries: 8 }); });
const context = { agentId: 'synthetic-qa', runtime: 'opencode', role: 'dev', sourceRevision: null, taskSha256: 'a'.repeat(64), resumed: false };
function attempt(outcome: 'success' | 'failure' | 'interrupted' = 'success') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'session-independent-qa-')); homes.push(home);
  const evidence = new SessionEvidence(home, context); evidence.record({ kind: 'start' });
  evidence.record({ kind: 'finish', outcome, usageCoverage: 'complete', usageScope: 'attempt', usageSource: 'opencode-message-v1', inputTokens: 10, outputTokens: 2, costUsd: 0.5 });
  return { home, file: path.join(home, 'session-evidence', evidence.id + '.jsonl') };
}

it.each(['allowed', 'blocked', 'unknown', undefined])('withholds offline metrics when a finish has nonterminal outcome %s', outcome => {
  const { home, file } = attempt(), rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  rows[1].outcome = outcome; fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  expect(readSessionAttempts(home)[0].unreadable).toBe(true);
  expect(summarizeSessionEvidence(home)).toMatchObject({ attempts: 1, success: 0, failure: 0, interrupted: 0, unreadable: 1, unknownTokenUsage: 1, observedCostUsd: null, costMeasuredAttempts: 0 });
});
it.each(['success', 'failure', 'interrupted'] as const)('retains actual measured native work for terminal outcome %s', outcome => {
  const { home } = attempt(outcome); expect(readSessionAttempts(home)[0].unreadable).toBe(false);
  expect(summarizeSessionEvidence(home)).toMatchObject({ attempts: 1, [outcome]: 1, unreadable: 0, unknownTokenUsage: 0, observedCostUsd: 0.5, costMeasuredAttempts: 1 });
});
