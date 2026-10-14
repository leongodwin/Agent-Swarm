import { z } from 'zod';
import type { Request } from './targetOperations.ts';
import { dataverseGuid,targetBindingSchema,type TargetAction } from './targetOperations.ts';
import {verifyDataverseIdentity} from './dataverseIdentity.ts';
import {platformIdentitySchema,identityField,identityRoot,type PlatformIdentity,type Command} from './identityContracts.ts';

export {platformIdentitySchema,type PlatformIdentity,type Command} from './identityContracts.ts';
export function parsePacIdentity(output: string) {
  return z.object({ organizationId: dataverseGuid, userId: dataverseGuid, environmentUrl: z.url(), environmentId: z.string().min(1), username: z.email() }).parse({
    organizationId: identityField(output,'Org ID'), userId: identityField(output,'User ID'), environmentUrl: identityRoot(identityField(output,'Org URL')), environmentId: identityField(output,'Environment ID'), username: identityField(output,'User Email'),
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
  platformIdentitySchema.parse(identity);targetBindingSchema.parse(binding);const target=identityRoot(environmentUrl);
  const checks=await Promise.allSettled([
    Promise.resolve().then(async()=>{
      const pac=parsePacIdentity(await command('pac',['org','who','--environment',target]));
      if(pac.environmentUrl!==target||pac.organizationId.toLowerCase()!==binding.organizationId.toLowerCase()||pac.userId.toLowerCase()!==binding.userId.toLowerCase()||pac.environmentId.toLowerCase()!==identity.environmentId.toLowerCase()||pac.username.toLowerCase()!==identity.username.toLowerCase())throw new Error('PAC authentication does not match the approved platform target/account');
    }),
    Promise.resolve().then(()=>verifyDataverseIdentity(command,request,target,binding,identity)),
    ...(flowWho?[Promise.resolve().then(async()=>verifyFlowIdentity(await flowWho(),identity))]:[]),
  ]);
  const failed=checks.find((check):check is PromiseRejectedResult=>check.status==='rejected');if(failed)throw failed.reason;
  // Re-read the actual Dataverse account after the potentially slower provider reads.
  await verifyDataverseIdentity(command,request,target,binding,identity);
  return { checkedAt: new Date().toISOString(), environmentUrl: target, ...identity, ...binding, scope:'platform-identity-observation',pacObservationPasses:1,dataverseObservationPasses:2, providers: ['pac', 'dataverse', ...(flowWho ? ['flowagent'] : [])] };
}

/** Typed actions verify their executing providers; PAC publication retains the full check. */
export async function verifyTypedActionAuthentication(action:TargetAction,command:Command,request:Request,environmentUrl:string,binding:z.infer<typeof targetBindingSchema>,identity:PlatformIdentity,flowWho?:()=>Promise<unknown>){
  if(action.type==='copilot-publish')return verifyPlatformAuthentication(command,request,environmentUrl,binding,identity,flowWho);
  if(action.type==='cloud-flow-state'&&!flowWho)throw new Error('Cloud-flow action requires FlowAgent authentication');
  await verifyDataverseIdentity(command,request,environmentUrl,binding,identity);
  if(action.type==='cloud-flow-state')verifyFlowIdentity(await flowWho!(),identity);
  const receipt=await verifyDataverseIdentity(command,request,environmentUrl,binding,identity);
  return {...receipt,scope:'typed-action-identity-observation',actionId:action.id,dataverseObservationPasses:2,providers:['dataverse',...(action.type==='cloud-flow-state'?['flowagent']:[])]};
}
