import {z} from 'zod';
import {identityField} from './identityContracts.ts';
import {dataverseGuid} from './targetOperations.ts';
/** PAC auth-list has no tenant field. Read the selected PAC profile itself;
 * neither the unrelated Azure account nor a requested tenant is substituted. */
export function parsePacTenantIdentity(output:string){return z.strictObject({tenantId:z.uuid(),username:z.email(),aadObjectId:z.uuid(),environmentId:dataverseGuid,organizationId:dataverseGuid}).parse({tenantId:identityField(output,'Tenant Id'),username:identityField(output,'User'),aadObjectId:identityField(output,'Entra ID Object Id'),environmentId:identityField(output,'Environment Id'),organizationId:identityField(output,'Organization Id')});}
