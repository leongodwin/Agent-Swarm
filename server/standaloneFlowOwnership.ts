import {z} from 'zod';
import {dataverseGuid} from './targetOperations.ts';
import {connectorProbeDigest} from './connectorMetadataProbe.ts';
import type {StandaloneProbePlan} from './standaloneMetadataProbe.ts';

/** Attributable current Owner evidence, not an exhaustive administrator census.
 * Creator metadata or mere ability to read/run never substitutes for this role. */
export function assertStandaloneFlowOwnership(plan:StandaloneProbePlan,flowId:string,raw:unknown){
 dataverseGuid.parse(flowId);
 const rows=z.object({value:z.array(z.unknown()).min(1).max(100)}).parse(raw).value;
 const expected=z.object({name:z.literal(plan.ownerObjectId),id:z.literal(`/providers/Microsoft.ProcessSimple/environments/${plan.identity.environmentId}/flows/${flowId}/permissions/${plan.ownerObjectId}`),type:z.literal('/providers/Microsoft.ProcessSimple/environments/flows/permissions'),properties:z.object({roleName:z.literal('Owner'),permissionType:z.literal('Principal'),principal:z.object({id:z.literal(plan.ownerObjectId),type:z.literal('User'),tenantId:z.literal(plan.identity.tenantId)})})});
 const matches=rows.map(row=>expected.safeParse(row)).filter(result=>result.success);
 if(matches.length!==1)throw Error('Exact current standalone flow Owner evidence required');
 return {permission:matches[0].data,flowId,ownerObjectId:plan.ownerObjectId,tenantId:plan.identity.tenantId,role:'Owner',observationSha256:connectorProbeDigest(raw),exhaustivePermissionCensus:false,permissionChangesAllowed:false};
}
