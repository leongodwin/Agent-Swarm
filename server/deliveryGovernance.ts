import { deliveryManifest } from './delivery.ts';
import { unavailableGovernance,type LifecycleCheck } from './lifecycleGovernance.ts';
import { evaluateStandardPolicies } from './standardPolicy.ts';

/** Declaration-level standard checks may deny, but cannot authorize a release.
 * A full provider must also independently extract package resources and evaluate
 * advanced/action/endpoint policies and comprehensive source/target schemas. */
export function createDeliveryGovernance(source:{observation(identity:{tenantId:string;caller:string}):unknown}):LifecycleCheck {
  return async request=>{
    const manifest=deliveryManifest.parse(request.manifest);
    if(!manifest.platformIdentity)return unavailableGovernance(request,['The release lacks a pinned platform identity for tenant policy and schema governance']);
    const identity={tenantId:manifest.platformIdentity.tenantId,caller:manifest.platformIdentity.username};
    let snapshot:unknown;
    try{snapshot=source.observation(identity);}
    catch{return unavailableGovernance(request,['Refresh the authenticated policy inventory for the exact approved tenant and account before governed delivery']);}
    const declared=manifest.postDeployActions.filter(action=>action.type==='connection-reference-check').map(action=>({id:`reference:${action.component}`,complete:true,connectors:[action.connectorId]}));
    if(!declared.length)return unavailableGovernance(request,['No independently complete app/flow connector inventory is available; advanced policy and comprehensive schema evidence are also required']);
    const standard=evaluateStandardPolicies(snapshot,identity,manifest.platformIdentity.environmentId,declared);
    const reasons=standard.status==='clear'?['Declared reference IDs passed standard classification; full package resource inventory, advanced policies and comprehensive schemas remain unverified']:standard.reasons.slice(0,20).map(reason=>reason.slice(0,1000));
    return {...unavailableGovernance(request,reasons),status:standard.status==='blocked'?'blocked':'unavailable',policySha256:standard.policySha256};
  };
}
