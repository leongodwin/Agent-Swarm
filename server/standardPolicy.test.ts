import { expect,it } from 'vitest';
import { evaluateStandardPolicies,standardConnectorId } from './standardPolicy.ts';
const identity={tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',caller:'leon@graspai.co.uk'};
const environment='11111111-1111-4111-8111-111111111111';const other='22222222-2222-4222-8222-222222222222';const now=Date.now();
const snapshot=(policies:unknown[])=>({...identity,schemaVersion:1,source:'Get-DlpPolicy module route',moduleVersion:'2.0.219',scope:'standard-policy-inventory',complete:true,pages:1,observedAt:new Date(now).toISOString(),policies});
const policy=(overrides:object={})=>({name:'policy-1',environmentType:'AllEnvironments',environments:[],defaultConnectorsClassification:'General',connectorGroups:[{classification:'Confidential',connectors:[{id:'/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps'}]},{classification:'Blocked',connectors:[{id:'shared_dropbox'}]}],...overrides});
const resource=(connectors:string[])=>[{id:'expense-app',complete:true,connectors}];
const evaluate=(policies:unknown[],connectors=['shared_commondataserviceforapps'])=>evaluateStandardPolicies(snapshot(policies),identity,environment,resource(connectors),now);
it('uses provider IDs case-insensitively without treating display names or custom URLs as IDs',()=>{
  expect(standardConnectorId('/providers/Microsoft.PowerApps/apis/SHARED_OUTLOOK')).toBe('shared_outlook');
  for(const id of ['Outlook','Http','https://example.test/apis/shared_outlook','/other/shared_outlook','shared_outlook?q=secret'])expect(standardConnectorId(id)).toBeNull();
});
it('evaluates blocked connectors, default groups and group mixing per resource',()=>{
  expect(evaluate([policy()]).status).toBe('clear');expect(evaluate([policy()],['shared_dropbox']).status).toBe('blocked');
  expect(evaluate([policy()],['shared_commondataserviceforapps','shared_outlook']).status).toBe('blocked');
  const separate=evaluateStandardPolicies(snapshot([policy()]),identity,environment,[{id:'app-a',complete:true,connectors:['shared_commondataserviceforapps']},{id:'app-b',complete:true,connectors:['shared_outlook']}],now);
  expect(separate.status).toBe('clear');expect(separate.complianceVerified).toBe(false);expect(separate.scope).toBe('declared-resource-standard-classification');
  expect(evaluate([policy({defaultConnectorsClassification:'Confidential'})],['shared_commondataserviceforapps','shared_outlook']).status).toBe('clear');
});
it('applies include/exclude environment scope exactly and combines policies without collapsing their groups',()=>{
  expect(evaluate([policy({environmentType:'OnlyEnvironments',environments:[{name:other}]})],['shared_dropbox']).status).toBe('clear');
  expect(evaluate([policy({environmentType:'OnlyEnvironments',environments:[{name:environment.toUpperCase()}]})],['shared_dropbox']).status).toBe('blocked');
  expect(evaluate([policy({environmentType:'ExceptEnvironments',environments:[{name:environment}]})],['shared_dropbox']).status).toBe('clear');
  expect(evaluate([policy({environmentType:'ExceptEnvironments',environments:[{name:other}]})],['shared_dropbox']).status).toBe('blocked');
  const both=[policy({name:'business',defaultConnectorsClassification:'Confidential',connectorGroups:[]}),policy({name:'non-business',defaultConnectorsClassification:'General',connectorGroups:[]})];
  expect(evaluate(both,['shared_outlook']).status).toBe('clear');
});
it('denies unknown policy features, ambiguous connector classifications and nonblockable default exceptions',()=>{
  for(const candidate of [policy({customConnectorPatterns:[]}),policy({environmentType:'FutureScope'}),policy({environments:[{name:environment}]}),policy({environmentType:'OnlyEnvironments',environments:[{name:environment},{name:environment}]}),policy({connectorGroups:[{classification:'General',connectors:[]},{classification:'General',connectors:[]}]}),policy({connectorGroups:[{classification:'General',connectors:[{id:'shared_outlook'},{id:'SHARED_OUTLOOK'}]}]})])expect(evaluate([candidate]).status).toBe('unavailable');
  expect(evaluate([policy({defaultConnectorsClassification:'Blocked'})],['shared_outlook']).status).toBe('unavailable');
  expect(evaluate([policy({connectorGroups:[{classification:'General',connectors:[{id:'Http'}]}]})]).status).toBe('unavailable');
  expect(evaluate([],['Http']).status).toBe('unavailable');
});
it('rejects mismatched or stale observations and incomplete or duplicate resource inventories',()=>{
  expect(evaluate([]).status).toBe('clear');expect(evaluate([]).policySha256).toMatch(/^[a-f0-9]{64}$/);
  for(const [observed,resources] of [[{...snapshot([]),caller:'other@company.test'},resource([])],[{...snapshot([]),observedAt:new Date(now-900001).toISOString()},resource([])],[snapshot([]),[]],[snapshot([]),[{id:'app',complete:false,connectors:[]}]],[snapshot([]),[...resource([]),...resource([])]]] as const)expect(evaluateStandardPolicies(observed,identity,environment,resources,now).status).toBe('unavailable');
});
it('bounds evaluation work and retained diagnostics instead of blocking the event loop on oversized policy products',()=>{
  const many=Array.from({length:1001},(_,index)=>policy({name:`policy-${index}`}));
  const resources=Array.from({length:1000},(_,index)=>({id:`resource-${index}`,complete:true,connectors:[]}));
  expect(evaluateStandardPolicies(snapshot(many),identity,environment,resources,now).status).toBe('unavailable');
  expect(evaluateStandardPolicies(snapshot([]),identity,environment,[{id:'app',complete:true,connectors:['x'.repeat(1024*1024)]}],now).status).toBe('unavailable');
  const result=evaluateStandardPolicies(snapshot([policy()]),identity,environment,resources.map(resource=>({...resource,connectors:['shared_dropbox']})),now);
  expect(result.status).toBe('blocked');expect(result.reasons).toHaveLength(30);
});
