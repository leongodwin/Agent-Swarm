import {expect,it,vi} from 'vitest';
import {createDeliveryGovernance} from './deliveryGovernance.ts';
import type {LifecycleRequest} from './lifecycleGovernance.ts';
const guid='11111111-1111-4111-8111-111111111111';
const manifest={schemaVersion:1,solutionUniqueName:'Expenses',solutionVersion:'1.0.0.0',solutionZip:'release.zip',hasUi:false,recovery:{runbook:'recovery.md',rehearsalReport:'drill.json'},documentation:['one.md','two.md','three.md'],build:[{executable:'node',args:['build.js']}],test:[{executable:'node',args:['test.js']}],verify:[{executable:'node',args:['verify.js']}],targetBinding:{organizationId:guid,userId:guid},platformIdentity:{tenantId:guid,username:'tester@company.test',environmentId:guid},targetComponents:[{key:'dataverse',kind:'connection-reference',logicalName:'exp_dataverse'}],postDeployActions:[{id:'binding',type:'connection-reference-check',component:'dataverse',connectionId:'approved',connectorId:'shared_commondataserviceforapps'}]};
const request:LifecycleRequest={phase:'build',sourceCommit:'a'.repeat(40),environmentUrl:'https://test.crm4.dynamics.com',releaseId:'release-1',checkout:'unused',manifest};
const observation=(policies:unknown[]=[])=>({schemaVersion:1,tenantId:guid,caller:'tester@company.test',observedAt:new Date().toISOString(),source:'Get-DlpPolicy module route',moduleVersion:'2.0.219',scope:'standard-policy-inventory',complete:true,pages:1,policies});
it('uses exact approved tenant/account and never promotes an empty standard inventory to full compliance',async()=>{
  const read=vi.fn(()=>observation());const check=createDeliveryGovernance({observation:read});const result=await check(request);
  expect(read).toHaveBeenCalledWith({tenantId:guid,caller:'tester@company.test'});expect(result.status).toBe('unavailable');expect(result.policySha256).toMatch(/^[a-f0-9]{64}$/);expect(result.reasons[0]).toContain('remain unverified');
});
it('blocks standard classification violations from the actual observation and handles missing target, discovery and resource contracts',async()=>{
  const blocked=createDeliveryGovernance({observation:()=>observation([{name:'policy',environmentType:'AllEnvironments',environments:[],defaultConnectorsClassification:'General',connectorGroups:[{classification:'Blocked',connectors:[{id:'shared_commondataserviceforapps'}]}]}])});
  expect((await blocked(request)).status).toBe('blocked');
  expect((await blocked({...request,manifest:{...manifest,platformIdentity:undefined}})).status).toBe('unavailable');
  const failed=createDeliveryGovernance({observation:()=>{throw new Error('private token');}});const result=await failed(request);expect(result.status).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('private token');
  const empty=createDeliveryGovernance({observation:()=>observation()});expect((await empty({...request,manifest:{...manifest,targetComponents:[],postDeployActions:[]}})).reasons[0]).toContain('connector inventory');
});
