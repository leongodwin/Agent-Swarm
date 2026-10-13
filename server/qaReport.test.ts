import {describe, expect, it} from 'vitest';
import {parseQaReport, QA_SCHEMA} from './qaReport.ts';
import type {SessionResult} from './agentRunner.ts';
const report = () => ({verdict: 'pass', summary: 'Verified the requested behaviour.', checks: [{name: 'Acceptance', result: 'pass', details: 'Observed the expected response.'}], commands: [], screenshots: []});
const result = (structured: unknown, text = ''): SessionResult => ({ok: true, structured, text, costUsd: 0, turns: 1, errors: []});
describe('untrusted QA reports', () => {
  it('accepts a complete pass and actionable failures without coercing their content', () => {
    expect(parseQaReport(result(report()))).toEqual(report());
    const failure = {...report(), verdict: 'fail', checks: [{name: 'Acceptance', result: 'fail', details: 'Response is incorrect.'}]};
    expect(parseQaReport(result(failure))?.verdict).toBe('fail');
    expect(parseQaReport(result({...report(), verdict: 'fail', fixInstructions: 'Fix the observed incorrect response.'}))?.verdict).toBe('fail');
    expect(QA_SCHEMA.additionalProperties).toBe(false);
  });
  it.each([
    null, [], false, {}, {...report(), summary: ''}, {...report(), summary: 4}, {...report(), summary: ' '},
    {...report(), checks: []}, {...report(), checks: null}, {...report(), checks: [null]},
    {...report(), checks: [{name: 'Acceptance', result: 'unknown', details: 'Unknown outcome'}]},
    {...report(), checks: [{name: 'Acceptance', result: 'fail', details: 'Failed despite pass verdict'}]},
    {...report(), checks: [{name: 'Acceptance', result: 'skip', details: 'Never exercised'}]},
    {...report(), commands: [{command: 'npm test', result: null}]}, {...report(), screenshots: [5]},
    {...report(), screenshots: Array(13).fill('caption')}, {...report(), extra: 'unrecognized'},
    {...report(), verdict: 'fail'}, {...report(), checks: Array(201).fill(report().checks[0])},
  ])('rejects malformed, incomplete or contradictory evidence %#', value => {
    expect(parseQaReport(result(value))).toBeNull();
  });
  it('parses the last terminal report but never cherry-picks an earlier valid pass over a malformed report', () => {
    expect(parseQaReport(result(undefined, 'Done.\n```json\n' + JSON.stringify(report()) + '\n```'))).toEqual(report());
    expect(parseQaReport(result(undefined, JSON.stringify(report())))).toEqual(report());
    const text = '```json\n' + JSON.stringify(report()) + '\n```\n```json\n{"verdict":"pass"}\n```';
    expect(parseQaReport(result(undefined, text))).toBeNull();
    expect(parseQaReport(result(undefined, '```json\n' + JSON.stringify(report()) + '\n```\n```json\n{bad json}\n```'))).toBeNull();
    expect(parseQaReport(result({verdict: 'pass'}, JSON.stringify(report())))).toBeNull();
  });
  it('rejects failed, interrupted and oversized sessions regardless of their reported verdict', () => {
    expect(parseQaReport({...result(report()), ok: false})).toBeNull();
    expect(parseQaReport({...result(report()), interrupted: true})).toBeNull();
    expect(parseQaReport({...result(report()), errors: ['runtime failure']})).toBeNull();
    expect(parseQaReport(result(undefined, 'x'.repeat(1024 * 1024 + 1)))).toBeNull();
    expect(parseQaReport(result(undefined, 'No report available'))).toBeNull();
    expect(parseQaReport(result(undefined, '```json\n{bad json}\n```'))).toBeNull();
  });
});
