import {z} from 'zod';
import {platformIdentitySchema,type PlatformIdentity,type Command} from './platformAuth.ts';
import {dataverseGuid,targetBindingSchema,verifyTarget,type Request} from './targetOperations.ts';

export const currentOrganizationResource="RetrieveCurrentOrganization(AccessType=@p1)?@p1=Microsoft.Dynamics.CRM.EndpointAccessType'Default'";
function root(value:string){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('Dataverse identity requires an HTTPS organization root');
  return url.origin;
}
function field(output:string,label:string){
  if(Buffer.byteLength(output)>64*1024)throw new Error('Dataverse identity profile exceeds its bound');
  const pattern=new RegExp(`^[ \\t]*${label}:[ \\t]*(.*)$`,'i');
  const rows=output.split(/\r?\n/).map(line=>pattern.exec(line)).filter(row=>row!==null);
  if(rows.length!==1||!rows[0]![1].trim())throw new Error('Dataverse identity profile is missing or ambiguous');
  return rows[0]![1].trim();
}
/** Checks the provider used for metadata reads; this does not certify PAC or FlowAgent authentication. */
export async function verifyDataverseIdentity(command:Command,request:Request,environmentUrl:string,binding:z.infer<typeof targetBindingSchema>,identity:PlatformIdentity){
  targetBindingSchema.parse(binding);platformIdentitySchema.parse(identity);const target=root(environmentUrl);
  const checks=await Promise.allSettled([
    Promise.resolve().then(()=>verifyTarget(request,binding)),
    Promise.resolve().then(async()=>{
      const detail=z.object({Detail:z.object({OrganizationId:dataverseGuid,EnvironmentId:platformIdentitySchema.shape.environmentId,TenantId:z.uuid(),State:z.literal('Enabled')})}).parse(await request('GET',currentOrganizationResource)).Detail;
      if(detail.OrganizationId.toLowerCase()!==binding.organizationId.toLowerCase()||detail.EnvironmentId.toLowerCase()!==identity.environmentId.toLowerCase()||detail.TenantId.toLowerCase()!==identity.tenantId.toLowerCase())throw new Error('Dataverse organization differs from the approved tenant/environment');
    }),
    Promise.resolve().then(async()=>{
      const profile=await command('dataverse',['auth','who']);
      if(field(profile,'Tenant').toLowerCase()!==identity.tenantId.toLowerCase()||field(profile,'User').toLowerCase()!==identity.username.toLowerCase()||root(field(profile,'Environment'))!==target)throw new Error('Dataverse profile differs from the approved account/environment');
    }),
  ]);
  const failed=checks.find((check):check is PromiseRejectedResult=>check.status==='rejected');if(failed)throw failed.reason;
  return {scope:'dataverse-identity-observation' as const,checkedAt:new Date().toISOString(),environmentUrl:target,...binding,...identity,providers:['dataverse']};
}
