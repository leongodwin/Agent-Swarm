import {expect,it} from 'vitest';
import crypto from 'node:crypto';
import {compareAdvancedConnectorConstraints} from './advancedConstraints.ts';
const tenant='11111111-1111-4111-8111-111111111111',now=Date.now(),identity={tenantId:tenant,caller:'tester@company.test',environmentId:`Default-${tenant}`};
const entry={AllowedConnector:'/providers/Microsoft.PowerApps/apis/shared_office365',AllowedActionsMode:'SomeAllowed',AllowedActions:['SendEmailV2'],AllowedConnectionTypesMode:'AllAllowed'};
const resource={id:'flow',complete:true,connectors:['shared_office365'],operations:[{type:'OpenApiConnection',connector:'shared_office365',operationId:'SendEmailV2'}]};
function receipt(allow:unknown[]=[entry]){
  const facts={assignments:[{policyId:'policy-1',resourceId:identity.environmentId,resourceType:'Environment',tenantId:tenant,ruleSetCount:1}],policies:[{id:'policy-1',tenantId:tenant,name:'Synthetic observed policy',ruleSetCount:1,ruleSets:[{id:'ConnectorManagement',version:'1.0',inputs:{AllowedConnectorList:allow}}]}]};
  return {...identity,scope:'environment-rule-assignment-inventory',complete:false,complianceVerified:false,accountScope:'azure-cli-profile',status:'observed',checkedAt:new Date(now).toISOString(),reason:'Synthetic policy inventory',...facts,observationSha256:crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')};
}
function digest(value:ReturnType<typeof receipt>){value.observationSha256=crypto.createHash('sha256').update(JSON.stringify({assignments:value.assignments,policies:value.policies})).digest('hex');return value;}
it('matches documented action constraints without certifying permission or compliance',()=>{
  const result=compareAdvancedConnectorConstraints(receipt(),identity,[resource],now);expect(result).toMatchObject({status:'matched',complete:false,complianceVerified:false,matchedPolicies:['policy-1']});expect(result.reasons.join(' ')).toContain('does not verify');
  expect(compareAdvancedConnectorConstraints(receipt([{...entry,AllowedActionsMode:'AllAllowed',AllowedActions:undefined}]),identity,[{...resource,operations:[]}],now).status).toBe('matched');
});
it.each(['connector','action','case-sensitive-action','webhook'])('detects %s conflicts against the observed exact allowlist',mode=>{
  const target=structuredClone(resource);if(mode==='connector')target.connectors=['shared_teams'];if(mode==='action')target.operations[0].operationId='DeleteEmail';if(mode==='case-sensitive-action')target.operations[0].operationId='sendemailv2';if(mode==='webhook'){target.operations[0].type='OpenApiConnectionWebhook';target.operations[0].operationId='OnNewMail';}
  const result=compareAdvancedConnectorConstraints(receipt(),identity,[target],now);expect(result.status).toBe('conflict');expect(result.reasons.join(' ')).toContain('outside observed policy');expect(result.complianceVerified).toBe(false);
});
it('treats an explicit empty SomeAllowed action list as denying known actions',()=>{expect(compareAdvancedConnectorConstraints(receipt([{...entry,AllowedActions:[]}]),identity,[resource],now).status).toBe('conflict');});
it.each([{...entry,AllowedActionsMode:'Unknown'},{...entry,AllowedConnectionTypesMode:'SomeAllowed'},{...entry,AllowedConnector:'shared_office365'},{...entry,AllowedActions:undefined},{...entry,AllowedActions:['SendEmailV2','SendEmailV2']},{...entry,AllowedActions:['@dynamic']},{...entry,futureOverride:true}])('keeps unsupported or ambiguous connector settings unavailable: %#',allow=>{expect(compareAdvancedConnectorConstraints(receipt([allow]),identity,[resource],now).status).toBe('unavailable');});
it.each(['version','rule-id','override','duplicate-connector','unknown-input'])('does not infer policy semantics for %s',mode=>{
  const value=receipt();if(mode==='version')value.policies[0].ruleSets[0].version='2.0';if(mode==='rule-id')value.policies[0].ruleSets[0].id='UnknownRule';if(mode==='override')(value.assignments[0] as any).assignmentOverrides=[{permit:'anything'}];if(mode==='duplicate-connector')value.policies[0].ruleSets[0].inputs.AllowedConnectorList=[entry,{...entry,AllowedConnector:entry.AllowedConnector.toUpperCase()}];if(mode==='unknown-input')(value.policies[0].ruleSets[0].inputs as any).futureSetting=true;
  expect(compareAdvancedConnectorConstraints(digest(value),identity,[resource],now).status).toBe('unavailable');
});
it('keeps opacity unresolved while preserving a known negative constraint',()=>{
  const unknown={...resource,complete:false};expect(compareAdvancedConnectorConstraints(receipt(),identity,[unknown],now).status).toBe('unavailable');expect(compareAdvancedConnectorConstraints(receipt([]),identity,[unknown],now).status).toBe('conflict');
  expect(compareAdvancedConnectorConstraints(receipt(),identity,[{...resource,operations:[]}],now).status).toBe('unavailable');
  expect(compareAdvancedConnectorConstraints(receipt(),identity,[{...resource,operations:[{...resource.operations[0],type:'Unknown'}]}],now).status).toBe('unavailable');
  for(const missing of [{type:'OpenApiConnection',connector:'shared_office365'},{type:'OpenApiConnectionWebhook',operationId:'OnNewMail'}])expect(compareAdvancedConnectorConstraints(receipt(),identity,[{...resource,operations:[...resource.operations,missing]}],now).status).toBe('unavailable');
});
it.each(['digest','tenant','caller','environment','stale','future','unavailable'])('rejects an unbound %s receipt without carrying successful policy facts',mode=>{
  const value=receipt();if(mode==='digest')value.observationSha256='a'.repeat(64);if(mode==='tenant')value.tenantId='22222222-2222-4222-8222-222222222222';if(mode==='caller')value.caller='other@company.test';if(mode==='environment')value.environmentId=tenant;if(mode==='stale')value.checkedAt=new Date(now-60001).toISOString();if(mode==='future')value.checkedAt=new Date(now+30001).toISOString();if(mode==='unavailable')value.status='unavailable';
  const result=compareAdvancedConnectorConstraints(value,identity,[resource],now);expect(result.status).toBe('unavailable');expect(result.observationSha256).toBeUndefined();expect(result.matchedPolicies).toEqual([]);
});
it('does not convert no assignments, missing resources or contradictory connector inventories into permission',()=>{
  const empty=receipt();empty.assignments=[];empty.policies=[];
  expect(compareAdvancedConnectorConstraints(digest(empty),identity,[resource],now).status).toBe('unavailable');
  for(const resources of [[],[resource,resource],[{...resource,connectors:['shared_office365','shared_office365']}],[{...resource,connectors:['custom']}],[{...resource,connectors:[],operations:resource.operations}]])expect(compareAdvancedConnectorConstraints(receipt(),identity,resources,now).status).toBe('unavailable');
});
it('bounds operations and serialized resources before comparing policies',()=>{
  const large={...resource,operations:Array.from({length:10001},()=>resource.operations[0])};expect(compareAdvancedConnectorConstraints(receipt(),identity,[large],now).status).toBe('unavailable');
  expect(compareAdvancedConnectorConstraints(receipt(),identity,[{...resource,untrusted:'x'.repeat(2*1024*1024)}],now).status).toBe('unavailable');
});
