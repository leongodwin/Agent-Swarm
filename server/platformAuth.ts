import { z } from 'zod';
import type { Request } from './targetOperations.ts';
import { verifyTarget, dataverseGuid } from './targetOperations.ts';

export const platformIdentitySchema = z.object({ tenantId: z.uuid(), username: z.email(), environmentId: z.string().regex(/^(?:Default-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i) }).strict();
export type PlatformIdentity = z.infer<typeof platformIdentitySchema>;
export type Command = (executable: string, args: string[]) => Promise<string>;
export function parsePacIdentity(output: string) {
  const field = (label: string) => output.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, 'mi'))?.[1]?.trim();
  return z.object({ organizationId: dataverseGuid, userId: dataverseGuid, environmentUrl: z.url(), environmentId: z.string().min(1), username: z.email() }).parse({
    organizationId: field('Org ID'), userId: field('User ID'), environmentUrl: field('Org URL'), environmentId: field('Environment ID'), username: field('User Email'),
  });
}
export function verifyFlowIdentity(value: unknown, identity: PlatformIdentity) {
  const data = z.object({ azIdentity: z.object({ tenantId: z.string(), user: z.string() }), tokenIdentity: z.object({ tenantId: z.string(), username: z.string() }),
    effectiveConnectivityIdentity: z.object({ tenantId: z.string(), username: z.string() }), identityMismatch: z.literal(false), connectivityIdentityMismatch: z.literal(false) }).parse(value);
  for (const account of [data.azIdentity, data.tokenIdentity, data.effectiveConnectivityIdentity]) {
    const username = 'user' in account ? account.user : account.username;
    if (account.tenantId.toLowerCase() !== identity.tenantId.toLowerCase() || username.toLowerCase() !== identity.username.toLowerCase()) throw new Error('FlowAgent authentication differs from the approved tenant/account');
  }
}
/** Consolidate readiness and target identity, while providers keep their own secure caches. */
export async function verifyPlatformAuthentication(command: Command, request: Request, environmentUrl: string,
  binding: { organizationId: string; userId: string }, identity: PlatformIdentity, flowWho?: () => Promise<unknown>) {
  const pac = parsePacIdentity(await command('pac', ['org', 'who', '--environment', environmentUrl]));
  if (new URL(pac.environmentUrl).origin !== new URL(environmentUrl).origin || pac.organizationId.toLowerCase() !== binding.organizationId.toLowerCase() || pac.userId.toLowerCase() !== binding.userId.toLowerCase() || pac.environmentId.toLowerCase() !== identity.environmentId.toLowerCase() || pac.username.toLowerCase() !== identity.username.toLowerCase()) throw new Error('PAC authentication does not match the approved platform target/account');
  await verifyTarget(request, binding);
  const profile = await command('dataverse', ['auth', 'who']);
  const tenant = profile.match(/^\s*Tenant:\s*([a-f0-9-]{36})\s*$/mi)?.[1];
  const user = profile.match(/^\s*User:\s*(\S+)\s*$/mi)?.[1];
  const environment = profile.match(/^\s*Environment:\s*(https:\/\/\S+)\s*$/mi)?.[1];
  if (!tenant || tenant.toLowerCase() !== identity.tenantId.toLowerCase() || user?.toLowerCase() !== identity.username.toLowerCase() || !environment || new URL(environment).origin !== new URL(environmentUrl).origin) throw new Error('Dataverse profile differs from the approved platform tenant/account/environment');
  if (flowWho) verifyFlowIdentity(await flowWho(), identity);
  return { checkedAt: new Date().toISOString(), environmentUrl: new URL(environmentUrl).origin, ...identity, ...binding, providers: ['pac', 'dataverse', ...(flowWho ? ['flowagent'] : [])] };
}
