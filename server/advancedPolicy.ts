import {z} from 'zod';
import crypto from 'node:crypto';
import {deliveryCommands,type DeliveryDependencies} from './delivery.ts';
import {platformIdentitySchema} from './identityContracts.ts';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),environment=platformIdentitySchema.shape.environmentId;
const assignment=z.object({policyId:id,resourceId:environment,resourceType:z.literal('Environment'),tenantId:z.uuid(),ruleSetCount:z.number().int().min(0).max(100)}).passthrough();
const policy=z.object({id,tenantId:z.uuid(),name:z.string().min(1).max(500),ruleSetCount:z.number().int().min(0).max(100),ruleSets:z.array(z.object({id,version:z.string().min(1).max(100),inputs:z.record(z.string(),z.unknown())}).passthrough()).max(100)}).passthrough();
export const advancedPolicyObservation=z.strictObject({scope:z.literal('environment-rule-assignment-inventory'),complete:z.literal(false),complianceVerified:z.literal(false),accountScope:z.literal('azure-cli-profile'),status:z.enum(['observed','unavailable']),tenantId:z.uuid(),caller:z.email(),environmentId:environment,checkedAt:z.iso.datetime(),reason:z.string().min(1).max(1000),assignments:z.array(assignment).max(10),policies:z.array(policy).max(10),observationSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).superRefine((value,ctx)=>{
  const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
  if(value.status==='unavailable'){
    if(value.assignments.length||value.policies.length||value.observationSha256)invalid('Unavailable observations cannot retain successful policy facts');
    return;
  }
  const facts=JSON.stringify({assignments:value.assignments,policies:value.policies});
  if(Buffer.byteLength(facts)>8*1024*1024||value.observationSha256!==crypto.createHash('sha256').update(facts).digest('hex'))invalid('Observed policy facts exceed their bound or differ from their digest');
  if(value.assignments.length!==value.policies.length||new Set(value.assignments.map(row=>row.policyId.toLowerCase())).size!==value.assignments.length||new Set(value.policies.map(row=>row.id.toLowerCase())).size!==value.policies.length)invalid('Policy facts are incomplete or ambiguous');
  for(const row of value.assignments){
    const detail=value.policies.find(detail=>detail.id===row.policyId);
    if(row.tenantId.toLowerCase()!==value.tenantId.toLowerCase()||row.resourceId.toLowerCase()!==value.environmentId.toLowerCase()||!detail||detail.tenantId.toLowerCase()!==value.tenantId.toLowerCase()||detail.ruleSetCount!==row.ruleSetCount||detail.ruleSetCount!==detail.ruleSets.length||new Set(detail.ruleSets.map(rule=>rule.id.toLowerCase())).size!==detail.ruleSets.length)invalid('Policy facts do not match their observed tenant, environment or assignment');
  }
});
export type AdvancedPolicyObservation=z.infer<typeof advancedPolicyObservation>;
export interface AdvancedPolicyRequest {tenantId:string;caller:string;environmentId:string;checkout:string;signal?:AbortSignal}
export type AdvancedPolicyObserver=(request:AdvancedPolicyRequest)=>Promise<AdvancedPolicyObservation>;

/** Fixed read-only API routes. Assigned policy facts do not establish enforcement mode or catalogue semantics. */
export function createAdvancedPolicyObserver(commands:Pick<DeliveryDependencies,'run'>=deliveryCommands):AdvancedPolicyObserver{
  return async input=>{
    const identity=z.strictObject({tenantId:z.uuid(),caller:z.email(),environmentId:environment}).parse({tenantId:input.tenantId,caller:input.caller,environmentId:input.environmentId});
    const unavailable=():AdvancedPolicyObservation=>({...identity,scope:'environment-rule-assignment-inventory',complete:false,complianceVerified:false,accountScope:'azure-cli-profile',status:'unavailable',checkedAt:new Date().toISOString(),reason:'Environment rule assignments or assigned policy details could not be freshly bound to the approved Azure CLI account and environment; no enforcement or compliance is certified',assignments:[],policies:[]});
    const signal=input.signal??new AbortController().signal;
    let bytes=0;
    const command=async(args:string[])=>{signal.throwIfAborted();const text=await commands.run({executable:'az',args},input.checkout,{},signal);signal.throwIfAborted();bytes+=Buffer.byteLength(text);if(Buffer.byteLength(text)>2*1024*1024||bytes>8*1024*1024)throw new Error('Advanced policy response exceeds its bound');return JSON.parse(text);};
    const account=async()=>{
      const value=z.object({tenantId:z.uuid(),user:z.object({name:z.email(),type:z.literal('user')})}).parse(await command(['account','show','--output','json','--only-show-errors']));
      if(value.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||value.user.name.toLowerCase()!==identity.caller.toLowerCase())throw new Error('Azure CLI account differs');
    };
    const read=(route:string,assignments=false)=>command(['rest','--method','get','--url',`https://api.powerplatform.com/governance/ruleBasedPolicies/${route}?${assignments?'includeRuleSetCounts=true&':''}api-version=2024-10-01`,'--resource','https://api.powerplatform.com','--output','json','--only-show-errors']);
    const pass=async()=>{
      // This API documents a complete value array, not a continuation contract.
      // Reject continuations rather than silently truncating or following arbitrary routes.
      const rows=z.strictObject({value:z.array(assignment).max(10)}).parse(await read(`environments/${identity.environmentId}/assignments`,true)).value;
      if(new Set(rows.map(row=>row.policyId)).size!==rows.length||rows.some(row=>row.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||row.resourceId.toLowerCase()!==identity.environmentId.toLowerCase()))throw new Error('Assignment identity differs or is ambiguous');
      const policies=[];
      for(const row of rows){
        const value=policy.parse(await read(row.policyId));
        if(value.id!==row.policyId||value.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||value.ruleSetCount!==value.ruleSets.length||value.ruleSetCount!==row.ruleSetCount||new Set(value.ruleSets.map(rule=>rule.id)).size!==value.ruleSets.length)throw new Error('Assigned policy details differ or are ambiguous');
        policies.push(value);
      }
      return {assignments:rows.slice().sort((a,b)=>a.policyId.localeCompare(b.policyId)),policies:policies.sort((a,b)=>a.id.localeCompare(b.id))};
    };
    try{
      await account();const before=await pass(),after=await pass();await account();signal.throwIfAborted();
      if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Assigned policy facts changed');
      return advancedPolicyObservation.parse({...identity,scope:'environment-rule-assignment-inventory',complete:false,complianceVerified:false,accountScope:'azure-cli-profile',status:'observed',checkedAt:new Date().toISOString(),reason:'Repeated environment assignment and policy reads agree with the observed Azure CLI profile; effective enforcement mode, connector catalogue/actions, classic endpoints, exceptions and schema remain unverified',...after,observationSha256:crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex')});
    }catch{return unavailable();}
  };
}
