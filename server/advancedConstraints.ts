import {z} from 'zod';
import {advancedPolicyObservation} from './advancedPolicy.ts';
import {standardConnectorId} from './standardPolicy.ts';

const actionId=z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const allowedConnector=z.strictObject({AllowedConnector:z.string().regex(/^\/providers\/Microsoft\.PowerApps\/apis\/shared_[a-z0-9_]+$/i),AllowedActionsMode:z.enum(['AllAllowed','SomeAllowed']),AllowedActions:z.array(actionId).max(10000).optional(),AllowedConnectionTypesMode:z.literal('AllAllowed')}).superRefine((entry,ctx)=>{
  if(entry.AllowedActionsMode==='SomeAllowed'&&!entry.AllowedActions||entry.AllowedActions&&new Set(entry.AllowedActions).size!==entry.AllowedActions.length)ctx.addIssue({code:'custom',message:'Action allowlist is missing or ambiguous'});
});
const inputs=z.strictObject({AllowedConnectorList:z.array(allowedConnector).max(1000)});
const resourcesSchema=z.array(z.object({id:z.string().min(1).max(500),complete:z.boolean(),connectors:z.array(z.string().min(1).max(500)).max(1000),operations:z.array(z.strictObject({type:z.string().min(1).max(200),connector:z.string().min(1).max(500).optional(),operationId:actionId.optional()})).max(10000)}).passthrough()).min(1).max(1000);
export interface AdvancedConstraintResult {
  scope:'observed-acp-connector-action-constraints';status:'matched'|'conflict'|'unavailable';complete:false;complianceVerified:false;
  observationSha256?:string;matchedPolicies:string[];reasons:string[];
}
/** Compare documented allowlist constraints only. Unknown modes/catalogue/security never grant release authority. */
export function compareAdvancedConnectorConstraints(raw:unknown,identity:{tenantId:string;caller:string;environmentId:string},resources:unknown,now=Date.now()):AdvancedConstraintResult{
  const result:AdvancedConstraintResult={scope:'observed-acp-connector-action-constraints',status:'unavailable',complete:false,complianceVerified:false,matchedPolicies:[],reasons:[]};
  const reason=(value:string)=>{if(result.reasons.length<30&&!result.reasons.includes(value))result.reasons.push(value.slice(0,1000));};
  try{
    const receipt=advancedPolicyObservation.parse(raw),age=now-Date.parse(receipt.checkedAt);
    if(receipt.status!=='observed'||receipt.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||receipt.caller.toLowerCase()!==identity.caller.toLowerCase()||receipt.environmentId.toLowerCase()!==identity.environmentId.toLowerCase()||age>60000||age < -30000)throw new Error('Policy observation is unavailable or differs from the approved scope');
    if(Buffer.byteLength(JSON.stringify(resources))>2*1024*1024)throw new Error('Resource bound exceeded');
    const targets=resourcesSchema.parse(resources);
    if(new Set(targets.map(resource=>resource.id)).size!==targets.length||targets.reduce((sum,resource)=>sum+resource.operations.length+resource.connectors.length,0)>10000)throw new Error('Resource inventory is ambiguous or exceeds its bound');
    result.observationSha256=receipt.observationSha256;
    let unknown=false,conflict=false;
    for(const target of targets){
      if(!target.complete){unknown=true;reason('Opaque resource operations remain unverified');}
      if(target.operations.some(operation=>['OpenApiConnection','OpenApiConnectionWebhook'].includes(operation.type)&&(!operation.connector||!operation.operationId))){unknown=true;reason('Connector operation identity is incomplete');}
    }
    for(const policy of receipt.policies){
      const assignment=receipt.assignments.find(row=>row.policyId===policy.id)!;
      if([assignment.assignmentOverrides,policy.assignmentOverrides].some(value=>value!==undefined&&(!Array.isArray(value)||value.length))){unknown=true;reason('Assignment overrides require an independent effective-policy adapter');continue;}
      for(const rule of policy.ruleSets){
        if(rule.id!=='ConnectorManagement'||rule.version!=='1.0'){unknown=true;reason('An assigned rule ID or version requires an independent evaluator');continue;}
        const parsed=inputs.safeParse(rule.inputs);
        if(!parsed.success){unknown=true;reason('ConnectorManagement contains unsupported connection types, actions or input semantics');continue;}
        const entries=new Map(parsed.data.AllowedConnectorList.map(entry=>[standardConnectorId(entry.AllowedConnector)!,entry]));
        if(entries.size!==parsed.data.AllowedConnectorList.length){unknown=true;reason('ConnectorManagement connector identities are ambiguous');continue;}
        result.matchedPolicies.push(policy.id);
        for(const target of targets){
          const connectors=target.connectors.map(standardConnectorId);
          if(connectors.some(id=>!id)||new Set(connectors).size!==connectors.length){unknown=true;reason('Packaged connector identities require independent resolution');continue;}
          for(const connector of connectors as string[]){
            const entry=entries.get(connector);
            if(!entry){conflict=true;reason(`Resource ${target.id.slice(0,160)} uses ${connector.slice(0,160)} outside observed policy ${policy.id}'s connector allowlist`);continue;}
            const operations=target.operations.filter(operation=>standardConnectorId(operation.connector??'')===connector);
            if(entry.AllowedActionsMode==='SomeAllowed'){
              if(!operations.length){unknown=true;reason('Action-restricted connector lacks independently extracted operation IDs');}
              for(const operation of operations){
                if(!['OpenApiConnection','OpenApiConnectionWebhook'].includes(operation.type)||!operation.operationId){unknown=true;reason('An action-restricted operation requires an independent adapter');continue;}
                if(!entry.AllowedActions!.includes(operation.operationId)){conflict=true;reason(`Resource ${target.id.slice(0,160)} action ${operation.operationId} on ${connector.slice(0,160)} is outside observed policy ${policy.id}'s action allowlist`);}
              }
            }
          }
          if(target.operations.some(operation=>operation.connector&&!connectors.includes(standardConnectorId(operation.connector)))){unknown=true;reason('Packaged operations differ from their resource connector inventory');}
        }
      }
    }
    if(!result.matchedPolicies.length){unknown=true;reason('No supported observed ConnectorManagement rule establishes effective policy absence or permission');}
    result.status=conflict?'conflict':unknown?'unavailable':'matched';
    result.reasons=[...result.reasons.slice(0,29),'This comparison does not verify effective enforcement mode, connector catalogue, connection types, classic endpoints, exceptions or comprehensive resource/schema coverage'];
    return result;
  }catch{
    return {...result,status:'unavailable',observationSha256:undefined,matchedPolicies:[],reasons:['Fresh scope-bound policy facts and bounded package operations are required for advanced constraint comparison']};
  }
}
