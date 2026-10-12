import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { apiVerificationSchema, verifyApiIndependently } from './apiVerification.ts';
import { releasePlanSchema } from './releasePlan.ts';
const id = '11111111-1111-4111-8111-111111111111';
const api = apiVerificationSchema.parse({ binding: { organizationId: id, userId: id }, checks: ['journey', 'authorization', 'persistence', 'error-handling'].map((category) => ({ name: 'Observe ' + category, category, criterion: 0, resource: 'WhoAmI', assertions: [{ pointer: ['OrganizationId'], equals: id }] })) });
it('verifies caller repeatedly, never writes, and retains no response bodies', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-proof-'));
  try {
    const request = vi.fn(async () => ({ OrganizationId: id, UserId: id, sensitive: 'do not retain' }));
    expect(await verifyApiIndependently(api, request, dir, new AbortController().signal)).toEqual(['independent-api.json']);
    expect(request.mock.calls).toHaveLength(10);
    expect(await fs.readFile(path.join(dir, 'independent-api.json'), 'utf8')).not.toContain('do not retain');
    await expect(verifyApiIndependently(api, async () => ({ OrganizationId: id, UserId: '22222222-2222-4222-8222-222222222222' }), dir, new AbortController().signal)).rejects.toThrow('approved target');
    const bad = structuredClone(api); bad.checks[0].assertions[0].equals = 'wrong';
    await expect(verifyApiIndependently(bad, request, dir, new AbortController().signal)).rejects.toThrow('assertion failed');
    expect(JSON.parse(await fs.readFile(path.join(dir, 'independent-api-failure.json'), 'utf8')).failed).toBe(true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
it('rejects cross-origin resources and API scope that claims browser or production acceptance', () => {
  for (const resource of ['https://attacker.test', '//attacker.test', 'accounts/../users', 'WhoAmI\nheader']) expect(apiVerificationSchema.safeParse({ ...api, checks: [{ ...api.checks[0], resource }] }).success).toBe(false);
  const plan = { acceptanceProfile: 'functional-development', name: 'Backend release', owner: 'ada', qaOwner: 'qa', requiredIssues: [1], components: ['Backend'], acceptanceCriteria: ['Observed backend contract'], quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['backend'] }, verification: { api, baseUrl: 'https://target.crm.dynamics.com', identities: [], scenarios: [] } };
  expect(releasePlanSchema.safeParse(plan).success).toBe(true);
  expect(releasePlanSchema.safeParse({ ...plan, acceptanceProfile: 'production' }).success).toBe(false);
  expect(releasePlanSchema.safeParse({ ...plan, verification: { ...plan.verification, api: undefined } }).success).toBe(false);
});
