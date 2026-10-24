import {z} from 'zod';
import {identityField} from './identityContracts.ts';
import {dataverseGuid} from './targetOperations.ts';
/** PAC auth-list has no tenant field. Read the selected PAC profile itself;
 * neither the unrelated Azure account nor a requested tenant is substituted. */
export function parsePacTenantIdentity(output:string){return z.strictObject({tenantId:z.uuid(),username:z.email(),aadObjectId:z.uuid(),environmentId:dataverseGuid,organizationId:dataverseGuid}).parse({tenantId:identityField(output,'Tenant Id'),username:identityField(output,'User'),aadObjectId:identityField(output,'Entra ID Object Id'),environmentId:identityField(output,'Environment Id'),organizationId:identityField(output,'Organization Id')});}
export const pacTenantWhoSchema=z.object({OrganizationId:dataverseGuid,UserId:dataverseGuid});
export function verifyPacTenantOrganization(profile:ReturnType<typeof parsePacTenantIdentity>,whoRaw:unknown,organizationRaw:unknown,userRaw:unknown,username:string){
 const who=pacTenantWhoSchema.parse(whoRaw),organization=z.object({Detail:z.object({TenantId:z.uuid(),EnvironmentId:dataverseGuid,OrganizationId:dataverseGuid,State:z.literal('Enabled')})}).parse(organizationRaw).Detail,user=z.object({systemuserid:dataverseGuid,azureactivedirectoryobjectid:z.uuid(),domainname:z.email(),isdisabled:z.literal(false),applicationid:z.null()}).parse(userRaw),same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
 if(!same(profile.username,username)||!same(organization.TenantId,profile.tenantId)||!same(organization.EnvironmentId,profile.environmentId)||!same(organization.OrganizationId,profile.organizationId)||!same(who.OrganizationId,profile.organizationId)||!same(user.systemuserid,who.UserId)||!same(user.azureactivedirectoryobjectid,profile.aadObjectId)||!same(user.domainname,username))throw Error('Selected PAC tenant and authenticated native organization/account differ');
}
