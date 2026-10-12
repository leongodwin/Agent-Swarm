import { expect, it } from 'vitest';
import { parsePacIdentity, verifyPlatformAuthentication, verifyFlowIdentity, type PlatformIdentity } from './platformAuth.ts';
const org = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const identity: PlatformIdentity = { tenantId: org, username: 'maker@example.com', environmentId: user };
const output = `Org ID: ${org}\nUser ID: ${user}\nOrg URL: https://target.crm4.dynamics.com/\nEnvironment ID: ${user}\nUser Email: maker@example.com`;
const who = { azIdentity: { tenantId: org, user: identity.username }, tokenIdentity: { tenantId: org, username: identity.username }, effectiveConnectivityIdentity: { tenantId: org, username: identity.username }, identityMismatch: false, connectivityIdentityMismatch: false };
it('accepts only explicit complete PAC identity observations', () => {
  expect(parsePacIdentity(output).organizationId).toBe(org);
  expect(() => parsePacIdentity('Connected as maker@example.com')).toThrow();
  expect(parsePacIdentity(output.replace(user, '48dd0213-f2f6-eb11-94ee-000d3a4bf7a5')).userId).toBe('48dd0213-f2f6-eb11-94ee-000d3a4bf7a5');
});
it('requires agreement across the effective flow identities', () => {
  expect(() => verifyFlowIdentity(who, identity)).not.toThrow();
  expect(() => verifyFlowIdentity({ ...who, tokenIdentity: { ...who.tokenIdentity, username: 'other@example.com' } }, identity)).toThrow('approved');
  expect(() => verifyFlowIdentity({ ...who, effectiveConnectivityIdentity: null }, identity)).toThrow();
});
it('creates a credential-free receipt only after both data planes and FlowAgent agree', async () => {
  const command = async (executable: string) => executable === 'pac' ? output : `Tenant: ${org}\nUser: maker@example.com\nEnvironment: https://target.crm4.dynamics.com/`;
  const request = async () => ({ OrganizationId: org, UserId: user });
  const result = await verifyPlatformAuthentication(command, request, 'https://target.crm4.dynamics.com', { organizationId: org, userId: user }, identity, async () => who);
  expect(result.providers).toEqual(['pac', 'dataverse', 'flowagent']);
  expect(JSON.stringify(result)).not.toContain('token');
  await expect(verifyPlatformAuthentication(command, request, 'https://wrong.crm4.dynamics.com', { organizationId: org, userId: user }, identity)).rejects.toThrow('PAC');
});
