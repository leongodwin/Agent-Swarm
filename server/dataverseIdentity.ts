import {z} from 'zod';
import {platformIdentitySchema,identityRoot,identityField,type PlatformIdentity,type Command} from './identityContracts.ts';
import {dataverseGuid,targetBindingSchema,verifyTarget,type Request} from './targetOperations.ts';

export const currentOrganizationResource="RetrieveCurrentOrganization(AccessType=@p1)?@p1=Microsoft.Dynamics.CRM.EndpointAccessType'Default'";
/** Checks the provider used for metadata reads; this does not certify PAC or FlowAgent authentication. */
export async function verifyDataverseIdentity(command:Command,request:Request,environmentUrl:string,binding:z.infer<typeof targetBindingSchema>,identity:PlatformIdentity){
  targetBindingSchema.parse(binding);platformIdentitySchema.parse(identity);const target=identityRoot(environmentUrl);
  const checks=await Promise.allSettled([
    Promise.resolve().then(()=>verifyTarget(request,binding)),
    Promise.resolve().then(async()=>{
      const detail=z.object({Detail:z.object({OrganizationId:dataverseGuid,EnvironmentId:platformIdentitySchema.shape.environmentId,TenantId:z.uuid(),State:z.literal('Enabled')})}).parse(await request('GET',currentOrganizationResource)).Detail;
      if(detail.OrganizationId.toLowerCase()!==binding.organizationId.toLowerCase()||detail.EnvironmentId.toLowerCase()!==identity.environmentId.toLowerCase()||detail.TenantId.toLowerCase()!==identity.tenantId.toLowerCase())throw new Error('Dataverse organization differs from the approved tenant/environment');
    }),
    Promise.resolve().then(async()=>{
      const profile=await command('dataverse',['auth','who']);
      if(identityField(profile,'Tenant').toLowerCase()!==identity.tenantId.toLowerCase()||identityField(profile,'User').toLowerCase()!==identity.username.toLowerCase())throw new Error('Dataverse profile differs from the approved account');
      const defaultTarget=identityRoot(identityField(profile,'Environment'));
      if(defaultTarget!==target){
        // The CLI accepts an explicit target independently of its default. Check
        // the executing target account as well; never select a global profile.
        const user=z.object({systemuserid:dataverseGuid,domainname:z.string(),isdisabled:z.literal(false),applicationid:z.null()}).parse(await request('GET',`systemusers(${binding.userId})?$select=systemuserid,domainname,isdisabled,applicationid`));
        if(user.systemuserid.toLowerCase()!==binding.userId.toLowerCase()||user.domainname.toLowerCase()!==identity.username.toLowerCase())throw new Error('Explicit-target Dataverse account differs from the approved account');
      }
    }),
  ]);
  const failed=checks.find((check):check is PromiseRejectedResult=>check.status==='rejected');if(failed)throw failed.reason;
  return {scope:'dataverse-identity-observation' as const,checkedAt:new Date().toISOString(),environmentUrl:target,...binding,...identity,providers:['dataverse']};
}
