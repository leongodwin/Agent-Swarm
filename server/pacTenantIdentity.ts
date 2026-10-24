import {z} from 'zod';
import {dataverseGuid} from './targetOperations.ts';
/** Discover the resource tenant from its authenticated organization, rather
 * than inventing it from a profile list or substituting an Azure account. */
export const pacTenantWhoSchema=z.object({OrganizationId:dataverseGuid,UserId:dataverseGuid});
export function verifyPacTenantOrganization(whoRaw:unknown,organizationRaw:unknown,userRaw:unknown,username:string){
 const who=pacTenantWhoSchema.parse(whoRaw),organization=z.object({Detail:z.object({TenantId:z.uuid(),EnvironmentId:dataverseGuid,OrganizationId:dataverseGuid,State:z.literal('Enabled')})}).parse(organizationRaw).Detail,user=z.object({systemuserid:dataverseGuid,azureactivedirectoryobjectid:z.uuid(),domainname:z.email(),isdisabled:z.literal(false),applicationid:z.null()}).parse(userRaw),same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 if(!same(organization.OrganizationId,who.OrganizationId)||!same(user.systemuserid,who.UserId)||!same(user.domainname,username))throw Error('Selected PAC account and authenticated native organization/account differ');
 return{tenantId:organization.TenantId,environmentId:organization.EnvironmentId,organizationId:organization.OrganizationId,userId:user.systemuserid,aadObjectId:user.azureactivedirectoryobjectid,username:user.domainname};
}
