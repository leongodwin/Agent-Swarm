import {expect,it} from 'vitest';
import {acceptanceScope,releasePlanSchema} from './releasePlan.ts';

const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const user='maker@example.test';
 const target={siteUrl:'https://example.sharepoint.com/sites/Probe',siteCollectionId:uuid(3),webId:uuid(4),listId:uuid(5)};
 return {name:'Synthetic single-user development probe',owner:'dev',qaOwner:'qa',requiredIssues:[1],components:['Canvas and SharePoint'],acceptanceCriteria:['Persist and process a request'],acceptanceProfile:'functional-development',
  quality:{maxTaskDurationMs:90000,maxSeriousAccessibilityIssues:0},monitoring:{intervalMinutes:15,criticalProbeIds:['processing']},
  verification:{baseUrl:'https://app.example.test',identities:[{id:'maker',expectedUser:user,userSelector:'#user'},{id:'restricted',expectedUser:user,userSelector:'#user'}],
   scenarios:['loading','empty','validation','failure','recovery','success'].map((state,i)=>({name:state,states:[state],category:['journey','journey','error-handling','authorization','persistence','journey'][i],identity:i===3?'restricted':'maker',criterion:0,
    steps:[{action:'press',selector:'#result',key:'Tab'},...(i===4?[{action:'reload'}]:[]),{action:'text',selector:'#result',contains:'Observable persisted result'}]})),
   nativeDeniedChecks:[{testName:'failure',scenarioId:'denied-create',contract:{adapter:'native-denied-create-v1',operation:'create-project',assertions:['authenticated-403','no-correlated-write','no-correlated-dispatch'],observationWindowMs:1000,pollIntervalMs:100},tenantId:uuid(1),deniedSubject:uuid(2),observerSubject:uuid(2),deniedIdentity:'restricted',observerIdentity:'maker',deniedUsername:user,observerUsername:user,targetSha256:'a'.repeat(64),target,
    authorizationBoundary:{kind:'single-user-selected-app',deniedClientId:uuid(6),observerClientId:uuid(7)}}]}};
}
it('admits only the explicitly scoped one-user selected-app development contract without certifying employee isolation',()=>{
 const parsed=releasePlanSchema.parse(fixture());expect(parsed.verification.identities).toHaveLength(2);
 expect(acceptanceScope(parsed).limitations.join(' ')).toContain('employee/approver permission isolation are not certified');
});
it.each(['production','legacy','missing-check','missing-boundary','missing-target','same-client','wrong-scenario','wrong-identity','extra-alias','duplicate-id'] as const)('rejects a single-user exception widened by %s',mode=>{
 const p=fixture(),check=p.verification.nativeDeniedChecks[0];
 if(mode==='production')p.acceptanceProfile='production';
 if(mode==='legacy')Reflect.deleteProperty(p,'acceptanceProfile');
 if(mode==='missing-check')Reflect.deleteProperty(p.verification,'nativeDeniedChecks');
 if(mode==='missing-boundary')Reflect.deleteProperty(check,'authorizationBoundary');
 if(mode==='missing-target')Reflect.deleteProperty(check,'target');
 if(mode==='same-client')check.authorizationBoundary.deniedClientId=check.authorizationBoundary.observerClientId;
 if(mode==='wrong-scenario')check.testName='loading';
 if(mode==='wrong-identity')check.observerIdentity='foreign';
 if(mode==='extra-alias')p.verification.identities.push({...p.verification.identities[0],id:'unproved-alias'});
 if(mode==='duplicate-id')p.verification.identities[1].id=p.verification.identities[0].id;
 expect(releasePlanSchema.safeParse(p).success).toBe(false);
});
it('continues accepting a genuine two-user production contract',()=>{
 const p=fixture();p.acceptanceProfile='production';const check=p.verification.nativeDeniedChecks[0];
 Reflect.deleteProperty(check,'authorizationBoundary');check.deniedSubject=uuid(8);check.deniedUsername='denied@example.test';p.verification.identities[1].expectedUser=check.deniedUsername;
 expect(releasePlanSchema.safeParse(p).success).toBe(true);
});
it('matches the same nominated user case-insensitively while requiring exact scenario and native bindings',()=>{
 const p=fixture();p.verification.identities[1].expectedUser='MAKER@example.test';expect(releasePlanSchema.safeParse(p).success).toBe(true);
});
