import { z } from 'zod';
import type { SessionResult } from './agentRunner.ts';

const text = z.string().trim().min(1).max(16000);
const reportShape = z.object({
  verdict: z.enum(['pass', 'fail']),
  summary: text,
  checks: z.array(z.object({name: text, result: z.enum(['pass', 'fail', 'skip']), details: text}).strict()).min(1).max(200),
  commands: z.array(z.object({command: text, result: text}).strict()).max(200),
  screenshots: z.array(text).max(12),
  fixInstructions: text.optional(),
}).strict();
export type QaReport = z.infer<typeof reportShape>;
export const QA_SCHEMA = {
  ...z.toJSONSchema(reportShape),
  allOf: [{
    if: {properties: {verdict: {const: 'pass'}},required:['verdict']},
    then: {properties: {checks: {items: {properties: {result: {const: 'pass'}}}}}},
  }],
} as Record<string, unknown>;
const schema = reportShape.superRefine((report, context) => {
  if (report.verdict === 'pass' && report.checks.some(check => check.result !== 'pass')) {
    context.addIssue({code: 'custom', message: 'A pass requires every reported check to pass'});
  }
  if (report.verdict === 'fail' && !report.fixInstructions && !report.checks.some(check => check.result === 'fail')) {
    context.addIssue({code: 'custom', message: 'A failed report needs actionable findings'});
  }
});

/** Agent output is untrusted evidence. Unknown results, coercions and empty passes are rejected. */
export function parseQaReport(result: SessionResult): QaReport | null {
  if (!result.ok || result.interrupted || result.errors.length > 0) return null;
  let raw = result.structured;
  if (raw === undefined || raw === null) {
    if (!result.text || Buffer.byteLength(result.text) > 1024 * 1024) return null;
    const fenced = [...result.text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)];
    const json = fenced.at(-1)?.[1] ?? result.text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    try {raw = JSON.parse(json);} catch {return null;}
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
