import {expect,it} from 'vitest';
import {assertStandaloneFlowOwnership} from './standaloneFlowOwnership.ts';
import {standaloneProbeFixturePlan} from './testFixtures/standaloneProbe.ts';
const flowId='22222222-2222-4222-8222-222222222222';
export function standaloneOwnerFixture(plan=standaloneProbeFixturePlan(),flow=flowId){return{value:[{name:plan.ownerObjectId,id:`/providers/Microsoft.ProcessSimple/environments/${plan.identity.environmentId}/flows/${flow}/permissions/${plan.ownerObjectId}`,type:'/providers/Microsoft.ProcessSimple/environments/flows/permissions',properties:{roleName:'Owner',permissionType:'Principal',principal:{id:plan.ownerObjectId,type:'User',tenantId:plan.identity.tenantId,displayName:'Unneeded contact label'}}}]};}
it('retains observed Owner evidence and drops contact labels without claiming an exhaustive census',()=>{
 const p=standaloneProbeFixturePlan(),raw=standaloneOwnerFixture(p),result=assertStandaloneFlowOwnership(p,flowId,raw);expect(result.permission?.properties.roleName).toBe('Owner');expect(result.exhaustivePermissionCensus).toBe(false);expect(result.permissionChangesAllowed).toBe(false);expect(JSON.stringify(result)).not.toContain('Unneeded contact label');expect(raw.value[0].properties.principal.displayName).toBeTruthy();
});
it.each(['principal','tenant','role','group','flow','empty','duplicate','malformed'] as const)('refuses %s as current Owner proof',mode=>{
 const p=standaloneProbeFixturePlan(),raw:any=standaloneOwnerFixture(p);
 if(mode==='principal')raw.value[0].properties.principal.id='44444444-4444-4444-8444-444444444444';if(mode==='tenant')raw.value[0].properties.principal.tenantId='44444444-4444-4444-8444-444444444444';if(mode==='role')raw.value[0].properties.roleName='CanEdit';if(mode==='group')raw.value[0].properties.principal.type='Group';if(mode==='flow')raw.value[0].id=raw.value[0].id.replace(flowId,'44444444-4444-4444-8444-444444444444');if(mode==='empty')raw.value=[];if(mode==='duplicate')raw.value.push(raw.value[0]);if(mode==='malformed')raw.value='not an array';expect(()=>assertStandaloneFlowOwnership(p,flowId,raw)).toThrow();
});
it('does not require a census of unrelated administrator or sharing entries',()=>{const p=standaloneProbeFixturePlan(),raw:any=standaloneOwnerFixture(p);raw.value.push({uninspectedOtherPrincipal:true});expect(assertStandaloneFlowOwnership(p,flowId,raw).role).toBe('Owner');});
