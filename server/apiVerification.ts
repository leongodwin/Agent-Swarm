import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { targetBindingSchema, verifyTarget, type Request } from './targetOperations.ts';
import {backendJourneySchema,verifyBackendJourney} from './backendJourney.ts';

export const apiVerificationSchema = z.object({
  binding: targetBindingSchema,
  transaction:backendJourneySchema.optional(),
  checks: z.array(z.object({ name: z.string().min(5).max(200), criterion: z.number().int().nonnegative(),
    category: z.enum(['journey', 'authorization', 'persistence', 'error-handling']),
    resource: z.string().min(1).max(2000).refine((value) => /^[A-Za-z][A-Za-z0-9_]*(?:[?(\/]|$)/.test(value) && !/[\\\r\n#]/.test(value) && !value.includes('://') && !value.includes('..'), 'Use a relative Dataverse resource'),
    assertions: z.array(z.object({ pointer: z.array(z.string().max(200)).max(20), equals: z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]) }).strict()).min(1).max(30),
  }).strict()).min(4).max(50),
}).strict();
export type ApiVerification = z.infer<typeof apiVerificationSchema>;
function at(value: unknown, pointer: string[]) {
  return pointer.reduce<unknown>((current, key) => current && typeof current === 'object' && Object.hasOwn(current, key) ? (current as Record<string, unknown>)[key] : undefined, value);
}

/** Runner-owned assertions plus an explicitly approved owned-record transaction;
 * never executes project verification code. Legacy plans remain read-only. */
export async function verifyApiIndependently(plan: ApiVerification, request: Request, evidence: string, signal: AbortSignal,context?:{runId:string;sourceCommit:string},authorizeTransaction?:()=>Promise<void>) {
  const results: { name: string; criterion: number; category: string; passed: boolean }[] = [];
  try {
    await verifyTarget(request, plan.binding);
    const transaction=plan.transaction?(context?await verifyBackendJourney(plan.transaction,plan.binding,request,evidence,signal,context,'journey',authorizeTransaction):(()=>{throw new Error('Runner transaction context is required');})()):undefined;
    for (const check of plan.checks) {
      if (signal.aborted) throw new Error('API verification cancelled');
      await verifyTarget(request, plan.binding);
      const response = await request('GET', check.resource);
      const passed = check.assertions.every((assertion) => at(response, assertion.pointer) === assertion.equals);
      results.push({ name: check.name, criterion: check.criterion, category: check.category, passed });
      if (!passed) throw new Error(`Independent API assertion failed: ${check.name}`);
    }
    await verifyTarget(request, plan.binding);
    if (signal.aborted) throw new Error('API verification cancelled');
    await fs.writeFile(path.join(evidence, 'independent-api.json'), JSON.stringify({ schemaVersion: 1, method: 'dataverse-api', binding: plan.binding, checkedAt: new Date().toISOString(), results,
      limitations: transaction?['Includes the explicit runner-owned synthetic transaction and audit-retention receipt; no UI acceptance or least-privilege isolation certification.']:['Read-only backend observations; no UI acceptance or least-privilege isolation certification. Transaction scenarios require separate correlated runtime evidence.'] }, null, 2));
    return ['independent-api.json',...(transaction?[transaction.file,'independent-journey-journal.json']:[])];
  } catch (error) {
    await fs.writeFile(path.join(evidence, 'independent-api-failure.json'), JSON.stringify({ results, failed: true }, null, 2));
    throw error;
  }
}
