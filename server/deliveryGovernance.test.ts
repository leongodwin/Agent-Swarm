import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {ZipFile} from 'yazl';
import {createDeliveryGovernance} from './deliveryGovernance.ts';
import type {LifecycleRequest} from './lifecycleGovernance.ts';
import {manifestDigest} from './lifecycleGovernance.ts';
import type {DeclaredSchemaObservation} from './declaredSchema.ts';
import {declaredSchemaObservation} from './declaredSchema.ts';
import type {AdvancedPolicyObservation,AdvancedPolicyRequest} from './advancedPolicy.ts';
import {advancedPolicyObservation} from './advancedPolicy.ts';
import type {ConnectorCatalogueObservation,ConnectorCatalogueRequest} from './connectorCatalogue.ts';
const guid='11111111-1111-4111-8111-111111111111';
const manifest={schemaVersion:1,solutionUniqueName:'Expenses',solutionVersion:'1.0.0.0',solutionZip:'release.zip',hasUi:false,recovery:{runbook:'recovery.md',rehearsalReport:'drill.json'},documentation:['one.md','two.md','three.md'],build:[{executable:'node',args:['build.js']}],test:[{executable:'node',args:['test.js']}],verify:[{executable:'node',args:['verify.js']}],targetBinding:{organizationId:guid,userId:guid},platformIdentity:{tenantId:guid,username:'tester@company.test',environmentId:guid},targetComponents:[{key:'dataverse',kind:'connection-reference',logicalName:'exp_dataverse'}],postDeployActions:[{id:'binding',type:'connection-reference-check',component:'dataverse',connectionId:'approved',connectorId:'shared_commondataserviceforapps'}]};
const request:LifecycleRequest={phase:'build',sourceCommit:'a'.repeat(40),environmentUrl:'https://test.crm4.dynamics.com',releaseId:'release-1',checkout:'unused',manifest};
const observation=(policies:unknown[]=[])=>({schemaVersion:1,tenantId:guid,caller:'tester@company.test',observedAt:new Date().toISOString(),source:'Get-DlpPolicy module route',moduleVersion:'2.0.219',scope:'standard-policy-inventory',complete:true,pages:1,policies});
const advanced=():AdvancedPolicyObservation=>({scope:'environment-rule-assignment-inventory',complete:false,complianceVerified:false,accountScope:'azure-cli-profile',status:'observed',tenantId:guid,caller:'tester@company.test',environmentId:guid,checkedAt:new Date().toISOString(),reason:'Repeated assignment inventory observed; enforcement mode is unverified',assignments:[],policies:[],observationSha256:crypto.createHash('sha256').update(JSON.stringify({assignments:[],policies:[]})).digest('hex')});
const directories:string[]=[];afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>fs.rm(directory,{recursive:true,force:true})));});
function connectorConstraints(allowMail:boolean){
  const value=advanced();
  value.assignments=[{policyId:'policy-1',resourceId:guid,resourceType:'Environment',tenantId:guid,ruleSetCount:1}];
  value.policies=[{id:'policy-1',tenantId:guid,name:'Synthetic connector policy',ruleSetCount:1,ruleSets:[{id:'ConnectorManagement',version:'1.0',inputs:{AllowedConnectorList:[
    {AllowedConnector:'/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',AllowedActionsMode:'AllAllowed',AllowedConnectionTypesMode:'AllAllowed'},
    {AllowedConnector:'/providers/Microsoft.PowerApps/apis/shared_office365',AllowedActionsMode:'SomeAllowed',AllowedActions:allowMail?['SendEmailV2']:['ReadEmail'],AllowedConnectionTypesMode:'AllAllowed'},
  ]}}]}];
  value.observationSha256=crypto.createHash('sha256').update(JSON.stringify({assignments:value.assignments,policies:value.policies})).digest('hex');return value;
}
function catalogueUnavailable(input:ConnectorCatalogueRequest):ConnectorCatalogueObservation{return {tenantId:input.tenantId,caller:input.caller,environmentId:input.environmentId,scope:'requested-connector-catalogue',accountScope:'azure-cli-profile',complete:false,complianceVerified:false,operationIdsVerified:false,status:'unavailable',checkedAt:new Date().toISOString(),requested:input.connectors,entries:[],failure:'delegated-permissions',elapsedMs:100,nativeCommands:2,reason:'Catalogue client requires approved delegated permissions; no access was granted'};}
it('does not advertise a catalogue file when its atomic publication fails',async()=>{
  const input=await packaged(),observe=async(value:ConnectorCatalogueRequest)=>{
    const observation=catalogueUnavailable(value),content=JSON.stringify({schemaVersion:1,scope:'package-connector-catalogue-observation',phase:input.phase,sourceCommit:input.sourceCommit,releaseId:input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:manifestDigest(input.manifest),packageSha256:input.packageSha256,observation},null,2);
    await fs.mkdir(path.join(input.evidenceDirectory!,`connector-catalogue-${crypto.createHash('sha256').update(content).digest('hex')}.json`));return observation;
  };
  const result=await createDeliveryGovernance({observation:()=>observation()},undefined,undefined,observe)(input);expect(result.status).toBe('unavailable');expect(result.connectorCatalogueFile).toBeUndefined();expect(result.reasons.join(' ')).toContain('catalogue metadata could not be bound');
});
it.each(['build','test','import','post-deploy','verify','health'] as const)('persists checksum-bound package catalogue requests and safe permission diagnostics at %s',async phase=>{
  const input=await packaged(),observe=vi.fn(async(value:ConnectorCatalogueRequest)=>catalogueUnavailable(value));
  const result=await createDeliveryGovernance({observation:()=>observation()},undefined,undefined,observe)({...input,phase});expect(result.status).toBe('unavailable');expect(result.reasons.join(' ')).toContain('approved delegated permissions');expect(result.connectorCatalogueFile).toMatch(/^connector-catalogue-[a-f0-9]{64}\.json$/);
  expect(observe.mock.calls[0][0].connectors).toEqual(['shared_commondataserviceforapps','shared_office365']);
  const content=await fs.readFile(path.join(input.evidenceDirectory!,result.connectorCatalogueFile!),'utf8');expect(result.connectorCatalogueFile).toBe(`connector-catalogue-${crypto.createHash('sha256').update(content).digest('hex')}.json`);expect(JSON.parse(content)).toMatchObject({phase,sourceCommit:input.sourceCommit,releaseId:input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:manifestDigest(input.manifest),packageSha256:input.packageSha256,observation:{failure:'delegated-permissions',operationIdsVerified:false}});
});
it.each(['tenant','caller','environment','requested','stale','future'])('rejects %s catalogue context before evidence persistence',async fault=>{
  const input=await packaged(),observe=async(value:ConnectorCatalogueRequest)=>{const result=catalogueUnavailable(value);if(fault==='tenant')result.tenantId='22222222-2222-4222-8222-222222222222';if(fault==='caller')result.caller='other@company.test';if(fault==='environment')result.environmentId='22222222-2222-4222-8222-222222222222';if(fault==='requested')result.requested=['shared_other'];if(fault==='stale')result.checkedAt=new Date(Date.now()-61000).toISOString();if(fault==='future')result.checkedAt=new Date(Date.now()+31000).toISOString();return result;};
  const result=await createDeliveryGovernance({observation:()=>observation()},undefined,undefined,observe)(input);expect(result.status).toBe('unavailable');expect(result.connectorCatalogueFile).toBeUndefined();expect(result.reasons.join(' ')).toContain('catalogue metadata could not be bound');
});
it.each(['build','test','import','post-deploy','verify','health'] as const)('blocks a package-derived action conflict before %s without converting matched constraints into permission',async phase=>{
  const input=await packaged(),value=connectorConstraints(false),check=createDeliveryGovernance({observation:()=>observation()},undefined,async()=>value);
  const result=await check({...input,phase});expect(result.status).toBe('blocked');expect(result.reasons.join(' ')).toContain('SendEmailV2');expect(result.reasons.join(' ')).toContain('outside observed policy');expect(result.advancedPolicyFile).toBeDefined();expect(result.artifactSha256).toBe(input.packageSha256);
  expect(result.packageInventorySha256).toBe(crypto.createHash('sha256').update(await fs.readFile(path.join(input.evidenceDirectory!,result.packageInventoryFile!))).digest('hex'));
  const matched=await createDeliveryGovernance({observation:()=>observation()},undefined,async()=>connectorConstraints(true))({...input,phase});expect(matched.status).toBe('unavailable');expect(matched.schemaSha256).toBeUndefined();
});
it('retains a known advanced constraint denial when classic policy discovery fails and rejects changed package digests',async()=>{
  const input=await packaged(),value=connectorConstraints(false),check=createDeliveryGovernance({observation:()=>{throw new Error('private classic detail');}},undefined,async()=>value);
  const result=await check(input);expect(result.status).toBe('blocked');expect(result.reasons.join(' ')).toContain('outside observed policy');expect(JSON.stringify(result)).not.toContain('private classic');
  const tampered=await check({...input,packageSha256:'f'.repeat(64)});expect(tampered.status).toBe('unavailable');expect(tampered.reasons.join(' ')).not.toContain('outside observed policy');
});
for(const classicFails of [false,true])it.each(['build','test','import','post-deploy','verify','health'] as const)(`retains a validated denial after publication fails (classic failure ${classicFails}) at %s`,async phase=>{
  const input=await packaged(),value=connectorConstraints(false),file=`advanced-policy-${crypto.createHash('sha256').update(JSON.stringify(advancedPolicyObservation.parse(value),null,2)).digest('hex')}.json`;
  await fs.mkdir(path.join(input.evidenceDirectory!,file),{recursive:true});
  const source={observation:()=>{if(classicFails)throw new Error('private classic detail');return observation();}};
  const result=await createDeliveryGovernance(source,undefined,async()=>value)({...input,phase});
  expect(result.status).toBe('blocked');expect(result.reasons.join(' ')).toContain('SendEmailV2');expect(result.reasons.join(' ')).toContain('outside observed policy');
  expect(result.reasons.join(' ')).toContain('could not be bound to this stage or persisted');expect(result.advancedPolicyFile).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('private classic detail');expect((await fs.stat(path.join(input.evidenceDirectory!,file))).isDirectory()).toBe(true);
});
it.each(['build','test','import','post-deploy','verify','health'] as const)('never advertises unpublished matched advanced evidence at %s',async phase=>{
  const input=await packaged(),value=connectorConstraints(true),file=`advanced-policy-${crypto.createHash('sha256').update(JSON.stringify(advancedPolicyObservation.parse(value),null,2)).digest('hex')}.json`;
  await fs.mkdir(path.join(input.evidenceDirectory!,file),{recursive:true});
  const result=await createDeliveryGovernance({observation:()=>observation()},undefined,async()=>value)({...input,phase});
  expect(result.status).toBe('unavailable');expect(result.advancedPolicyFile).toBeUndefined();expect(result.reasons.join(' ')).toContain('could not be bound to this stage or persisted');
});
it.each(['build','test','import','post-deploy','verify','health'] as const)('never advertises unpublished schema evidence at %s',async phase=>{
  const input=await packaged(),schema=async(value:LifecycleRequest):Promise<DeclaredSchemaObservation>=>{
    const receipt:DeclaredSchemaObservation={scope:'declared-target-schema',complete:false,status:'observed',phase:value.phase,sourceCommit:value.sourceCommit,releaseId:value.releaseId,environmentUrl:value.environmentUrl,manifestSha256:manifestDigest(value.manifest),checkedAt:new Date().toISOString(),reason:'Synthetic observed columns',identity:manifest.platformIdentity,binding:manifest.targetBinding,tables:['exp_report'],observations:[{resource:'EntityDefinitions',value:{}}]};
    const file=`declared-schema-${crypto.createHash('sha256').update(JSON.stringify(declaredSchemaObservation.parse(receipt),null,2)).digest('hex')}.json`;
    await fs.mkdir(path.join(input.evidenceDirectory!,file));return receipt;
  };
  const result=await createDeliveryGovernance({observation:()=>observation()},schema)({...input,phase});
  expect(result.status).toBe('unavailable');expect(result.declaredSchemaFile).toBeUndefined();expect(result.reasons.join(' ')).toContain('Declared schema evidence could not be bound to this stage or persisted');
});
async function packaged(customizationExtra='',rootExtra='',unknownParameter=false,ambiguousJson=false) {
  const checkout=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-governed-package-'));directories.push(checkout);const evidenceDirectory=path.join(checkout,'evidence');
  const definition = {
    triggers: { tick: { type: 'Recurrence' } },
    actions: {
      query: { type: 'OpenApiConnection', inputs: { host: { connectionName: 'dv', apiId: 'shared_commondataserviceforapps', operationId: 'ListRecords' },parameters:{entityName:'exp_reports',$select:'exp_title',...(unknownParameter?{savedQuery:'unresolved query'}:{})} } },
      mail: { type: 'OpenApiConnection', inputs: { host: { connectionName: 'mail', apiId: 'shared_office365', operationId: 'SendEmailV2' } } },
    },
  };
  const connectionReferences = {
    dv: { api: { name: 'shared_commondataserviceforapps' }, connection: { connectionReferenceLogicalName: 'exp_dataverse' } },
    mail: { api: { name: 'shared_office365' }, connection: { connectionReferenceLogicalName: 'exp_outlook' } },
  };
  const entries = {
    'solution.xml': `<ImportExportXml><SolutionManifest><UniqueName>Expenses</UniqueName><Version>1.0.0.0</Version><Managed>0</Managed><RootComponents><RootComponent type="29" id="{${guid}}"/>${rootExtra}</RootComponents></SolutionManifest></ImportExportXml>`,
    'customizations.xml': `<ImportExportXml><connectionreferences><connectionreference connectionreferencelogicalname="exp_dataverse"><connectorid>shared_commondataserviceforapps</connectorid></connectionreference><connectionreference connectionreferencelogicalname="exp_outlook"><connectorid>shared_office365</connectorid></connectionreference></connectionreferences><Workflows><Workflow WorkflowId="{${guid}}"><Category>5</Category><JsonFileName>/Workflows/flow.json</JsonFileName></Workflow></Workflows>${customizationExtra}</ImportExportXml>`,
    'Workflows/flow.json': ambiguousJson?JSON.stringify({properties:{connectionReferences,definition}}).replace('"actions":{','"actions":{"hidden":{"type":"Http"}},"act\\u0069ons":{'):JSON.stringify({ properties: { connectionReferences, definition } }),
  };
  const archive=new ZipFile();const chunks:Buffer[]=[];const bytes=new Promise<Buffer>((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});for(const [name,body] of Object.entries(entries))archive.addBuffer(Buffer.from(body),name,{compress:false});archive.end();const buffer=await bytes;await fs.writeFile(path.join(checkout,'release.zip'),buffer);
  return {...request,phase:'import' as const,checkout,evidenceDirectory,packageSha256:crypto.createHash('sha256').update(buffer).digest('hex'),manifest:{...manifest,targetComponents:[...manifest.targetComponents,{key:'outlook',kind:'connection-reference',logicalName:'exp_outlook'},{key:'flow',kind:'cloud-flow',logicalName:guid}],postDeployActions:[...manifest.postDeployActions,{id:'outlook-binding',type:'connection-reference-check',component:'outlook',connectionId:'approved-mail',connectorId:'shared_office365'}]}};
}
it.each(['build','test','import','post-deploy','verify','health'] as const)('retains known DLP denials in a schema-incomplete package at %s',async phase=>{
  const input=await packaged('','',true),policy={name:'mail-blocked',environmentType:'AllEnvironments',environments:[],defaultConnectorsClassification:'General',connectorGroups:[{classification:'Blocked',connectors:[{id:'shared_office365'}]}]};
  const result=await createDeliveryGovernance({observation:()=>observation([policy])})({...input,phase});expect(result.status).toBe('blocked');expect(result.reasons[0]).toContain('blocks shared_office365');
  const inventory=JSON.parse(await fs.readFile(path.join(input.evidenceDirectory!,result.packageInventoryFile!),'utf8'));expect(inventory.resourceInventoryComplete).toBe(false);expect(inventory.resources[0].complete).toBe(false);
});
it('does not authorize a schema-incomplete package when its known connectors have no standard denial',async()=>{const input=await packaged('','',true),result=await createDeliveryGovernance({observation:()=>observation()}) (input);expect(result.status).toBe('unavailable');expect(result.reasons.join(' ')).toContain('Resource inventory is incomplete');});
it('refreshes advanced assignments at all six stages and persists partial evidence without authorizing execution',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-advanced-policy-stage-'));directories.push(directory);const read=vi.fn(async(_input:AdvancedPolicyRequest)=>advanced());
  const check=createDeliveryGovernance({observation:()=>observation()},undefined,read);
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){
    const result=await check({...request,phase,evidenceDirectory:directory});expect(result.status).toBe('unavailable');expect(result.advancedPolicyFile).toMatch(/^advanced-policy-[a-f0-9]{64}\.json$/);
    expect(JSON.parse(await fs.readFile(path.join(directory,result.advancedPolicyFile!),'utf8'))).toMatchObject({complete:false,status:'observed'});
  }
  expect(read).toHaveBeenCalledTimes(6);expect(read.mock.calls[0][0]).toMatchObject({tenantId:guid,caller:'tester@company.test',environmentId:guid,checkout:request.checkout});
});
it.each(['tenant','caller','environment','stale','future'])('rejects unbound advanced %s observations before persistence',async mismatch=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-advanced-policy-context-'));directories.push(directory);const value=advanced();
  if(mismatch==='tenant')value.tenantId='22222222-2222-4222-8222-222222222222';if(mismatch==='caller')value.caller='other@company.test';if(mismatch==='environment')value.environmentId='22222222-2222-4222-8222-222222222222';if(mismatch==='stale')value.checkedAt=new Date(Date.now()-61000).toISOString();if(mismatch==='future')value.checkedAt=new Date(Date.now()+31000).toISOString();
  const result=await createDeliveryGovernance({observation:()=>observation()},undefined,async()=>value)({...request,evidenceDirectory:directory});expect(result.status).toBe('unavailable');expect(result.advancedPolicyFile).toBeUndefined();expect(await fs.readdir(directory)).toEqual([]);
});
it('keeps an issued advanced read owned when classic policy discovery fails',async()=>{
  let release!:(value:AdvancedPolicyObservation)=>void;const read=vi.fn(()=>new Promise<AdvancedPolicyObservation>(resolve=>{release=resolve;}));let settled=false;
  const pending=createDeliveryGovernance({observation:()=>{throw new Error('private classic detail');}},undefined,read)(request).then(value=>{settled=true;return value;});
  for(let i=0;i<5&&!read.mock.calls.length;i++)await Promise.resolve();expect(read).toHaveBeenCalledOnce();expect(settled).toBe(false);release(advanced());const result=await pending;expect(result.status).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('private');
});
it('uses exact approved tenant/account and never promotes an empty standard inventory to full compliance',async()=>{
  const read=vi.fn(()=>observation());const check=createDeliveryGovernance({observation:read});const result=await check(request);
  expect(read).toHaveBeenCalledWith({tenantId:guid,caller:'tester@company.test'});expect(result.status).toBe('unavailable');expect(result.policySha256).toMatch(/^[a-f0-9]{64}$/);expect(result.reasons[0]).toContain('remain unverified');
});
it('requests a fresh identity-bound observation at every lifecycle phase without granting full compliance',async()=>{
  const cached=vi.fn(()=>observation()),fresh=vi.fn(async()=>observation());const check=createDeliveryGovernance({observation:cached,ensureObservation:fresh});
  const controller=new AbortController();
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const) {
    const result=await check({...request,phase,signal:controller.signal});expect(result.phase).toBe(phase);expect(result.status).toBe('unavailable');
    expect(fresh).toHaveBeenLastCalledWith({tenantId:guid,caller:'tester@company.test'},{force:true,timeoutMs:45_000,signal:controller.signal});
  }
  expect(fresh).toHaveBeenCalledTimes(6);expect(cached).not.toHaveBeenCalled();
});

it('persists stage-bound declared schema evidence without substituting it for comprehensive governance',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'schema-stage-evidence-'));directories.push(directory);
  const schema=vi.fn(async(input:LifecycleRequest):Promise<DeclaredSchemaObservation>=>({scope:'declared-target-schema',complete:false,status:'unavailable',phase:input.phase,sourceCommit:input.sourceCommit,releaseId:input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:manifestDigest(input.manifest),checkedAt:new Date().toISOString(),reason:'No declared table contracts',tables:[],observations:[]}));
  const check=createDeliveryGovernance({observation:()=>observation()},schema);
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){
    const result=await check({...request,phase,evidenceDirectory:directory});expect(result.status).toBe('unavailable');expect(result.schemaSha256).toBeUndefined();expect(result.declaredSchemaFile).toMatch(/^declared-schema-[a-f0-9]{64}\.json$/);
    const content=await fs.readFile(path.join(directory,result.declaredSchemaFile!),'utf8');expect(JSON.parse(content)).toMatchObject({phase,complete:false});expect(result.declaredSchemaFile).toBe(`declared-schema-${crypto.createHash('sha256').update(content).digest('hex')}.json`);
  }
  expect(schema).toHaveBeenCalledTimes(6);
});
it.each(['release','manifest','stale','identity'])('rejects mismatched schema observation scope: %s',async mismatch=>{
  const schema=async(input:LifecycleRequest):Promise<DeclaredSchemaObservation>=>({scope:'declared-target-schema',complete:false,status:'observed',phase:input.phase,sourceCommit:input.sourceCommit,releaseId:mismatch==='release'?'another-release':input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:mismatch==='manifest'?'f'.repeat(64):manifestDigest(input.manifest),checkedAt:new Date(Date.now()-(mismatch==='stale'?120000:0)).toISOString(),reason:'Synthetic observed columns',identity:{...manifest.platformIdentity,tenantId:mismatch==='identity'?'22222222-2222-4222-8222-222222222222':guid},binding:manifest.targetBinding,tables:['exp_report'],observations:[{resource:'EntityDefinitions',value:{}}]});
  const result=await createDeliveryGovernance({observation:()=>observation()},schema)(request);
  expect(result.status).toBe('unavailable');expect(result.declaredSchemaFile).toBeUndefined();expect(result.reasons.join(' ')).toContain('could not be bound');
});
it('starts independent schema and policy observations together and preserves schema evidence when policy discovery fails',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'schema-policy-failure-'));directories.push(directory);
  let release!:(value:DeclaredSchemaObservation)=>void;const schema=vi.fn(()=>new Promise<DeclaredSchemaObservation>(resolve=>{release=resolve;}));
  const policy=vi.fn(async()=>{throw new Error('private policy detail');});
  const pending=createDeliveryGovernance({observation:policy},schema)({...request,evidenceDirectory:directory});
  for(let i=0;i<10&&!policy.mock.calls.length;i++)await Promise.resolve();expect(schema).toHaveBeenCalledOnce();expect(policy).toHaveBeenCalledOnce();
  release({scope:'declared-target-schema',complete:false,status:'unavailable',phase:request.phase,sourceCommit:request.sourceCommit,releaseId:request.releaseId,environmentUrl:request.environmentUrl,manifestSha256:manifestDigest(request.manifest),checkedAt:new Date().toISOString(),reason:'No declared table contracts',tables:[],observations:[]});
  const result=await pending;expect(result.status).toBe('unavailable');expect(result.declaredSchemaFile).toBeDefined();expect(JSON.stringify(result)).not.toContain('private policy detail');
});
it('awaits discovery and never falls back to a cached passing classification on fresh-read failure',async()=>{
  let reject!:(error:Error)=>void;const fresh=vi.fn(()=>new Promise<unknown>((_resolve,fail)=>{reject=fail;}));const cached=vi.fn(()=>observation());
  const check=createDeliveryGovernance({observation:cached,ensureObservation:fresh});let finished=false;
  const result=check(request).then(value=>{finished=true;return value;});await Promise.resolve();expect(finished).toBe(false);
  reject(new Error('private authentication detail'));const denied=await result;
  expect(denied.status).toBe('unavailable');expect(cached).not.toHaveBeenCalled();expect(JSON.stringify(denied)).not.toContain('private');
});
it('blocks standard classification violations from the actual observation and handles missing target, discovery and resource contracts',async()=>{
  const blocked=createDeliveryGovernance({observation:()=>observation([{name:'policy',environmentType:'AllEnvironments',environments:[],defaultConnectorsClassification:'General',connectorGroups:[{classification:'Blocked',connectors:[{id:'shared_commondataserviceforapps'}]}]}])});
  expect((await blocked(request)).status).toBe('blocked');
  expect((await blocked({...request,manifest:{...manifest,platformIdentity:undefined}})).status).toBe('unavailable');
  const failed=createDeliveryGovernance({observation:()=>{throw new Error('private token');}});const result=await failed(request);expect(result.status).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('private token');
  const empty=createDeliveryGovernance({observation:()=>observation()});expect((await empty({...request,manifest:{...manifest,targetComponents:[],postDeployActions:[]}})).reasons[0]).toContain('connector inventory');
});
it('evaluates connectors together inside the actual packaged flow and persists its independent inventory',async()=>{
  const input=await packaged();const source={observation:()=>observation([{name:'policy',environmentType:'AllEnvironments',environments:[],defaultConnectorsClassification:'General',connectorGroups:[{classification:'Confidential',connectors:[{id:'shared_commondataserviceforapps'}]}]}])};
  const result=await createDeliveryGovernance(source)(input);expect(result.status).toBe('blocked');expect(result.reasons.join(' ')).toContain('separates Business and Non-Business');
  const inventory=JSON.parse(await fs.readFile(path.join(input.evidenceDirectory,result.packageInventoryFile!),'utf8'));expect(inventory.archiveComplete).toBe(true);expect(inventory.resources[0].connectors).toEqual(['shared_commondataserviceforapps','shared_office365']);
});
it('passes independently packaged schema references to the fresh schema observer',async()=>{
  const input=await packaged(),seen:LifecycleRequest[]=[];
  const schema=async(value:LifecycleRequest):Promise<DeclaredSchemaObservation>=>{seen.push(value);return {scope:'declared-target-schema',complete:false,status:'unavailable',phase:value.phase,sourceCommit:value.sourceCommit,releaseId:value.releaseId,environmentUrl:value.environmentUrl,manifestSha256:manifestDigest(value.manifest),checkedAt:new Date().toISOString(),reason:'Resource schema correlation remains incomplete',tables:[],observations:[]};};
  const result=await createDeliveryGovernance({observation:()=>observation()},schema)(input);expect(result.status).toBe('unavailable');expect(seen).toHaveLength(1);expect(seen[0].resourceSchemaReferences).toContainEqual({resource:guid,entitySet:'exp_reports',columns:['exp_title']});expect(seen[0].packageSha256).toBe(input.packageSha256);
});
it('rejects package drift and omitted components/bindings while keeping unsupported overall acceptance unavailable',async()=>{
  const input=await packaged();const check=createDeliveryGovernance({observation:()=>observation()});
  expect((await check({...input,packageSha256:'f'.repeat(64)})).status).toBe('unavailable');
  expect((await check({...input,manifest:{...input.manifest,solutionVersion:'2.0.0.0'}})).status).toBe('blocked');
  expect((await check({...input,manifest:{...input.manifest,targetComponents:input.manifest.targetComponents.filter(component=>component.key!=='flow')}})).status).toBe('blocked');
  const missing=await check({...input,manifest:{...input.manifest,targetComponents:input.manifest.targetComponents.filter(component=>component.key!=='outlook'),postDeployActions:input.manifest.postDeployActions.filter(action=>action.component!=='outlook')}});expect(missing.status).toBe('blocked');expect(missing.reasons[0]).toContain('exp_outlook');
  const ready=await check(input);expect(ready.status).toBe('unavailable');expect(ready.reasons[0]).toContain('Inspectable package resources');expect(ready.reasons[0]).toContain('unverified');
});

it('rejects independently packaged undeclared relationships at each stage before policy observation',async()=>{
  const custom='<Entities><Entity><Name>exp_report</Name><EntityInfo><entity Name="exp_report"><attributes><attribute><LogicalName>exp_reportid</LogicalName><Type>primarykey</Type><RequiredLevel>systemrequired</RequiredLevel></attribute><attribute><LogicalName>exp_code</LogicalName><Type>nvarchar</Type><RequiredLevel>none</RequiredLevel></attribute></attributes></entity></EntityInfo></Entity></Entities><EntityRelationships><EntityRelationship Name="exp_Report_Line"><EntityRelationshipType>OneToMany</EntityRelationshipType><ReferencedEntityName>exp_report</ReferencedEntityName><ReferencingEntityName>exp_line</ReferencingEntityName><ReferencingAttributeName>exp_report</ReferencingAttributeName><CascadeDelete>Restrict</CascadeDelete></EntityRelationship></EntityRelationships>';
  const input=await packaged(custom,'<RootComponent type="1" schemaName="exp_report" behavior="0"/>');
  const declared={...input.manifest,targetComponents:[...input.manifest.targetComponents,{key:'report',kind:'dataverse-table',logicalName:'exp_report'}],postDeployActions:[...input.manifest.postDeployActions,{id:'schema',type:'schema-check',component:'report',columns:[{name:'exp_code',type:'String',required:'None'},{name:'exp_reportid',type:'Uniqueidentifier',required:'SystemRequired'}]}]};
  const observe=vi.fn(()=>observation());const check=createDeliveryGovernance({observation:observe});
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){
    const denied=await check({...input,manifest:declared,phase});expect(denied.status).toBe('blocked');expect(denied.reasons[0]).toContain('Package relationship');expect(denied.packageInventoryFile).toBeDefined();
  }
  expect(observe).not.toHaveBeenCalled();
  const fixed=structuredClone(declared);Object.assign(fixed.postDeployActions[fixed.postDeployActions.length-1],{structure:{relationships:[{kind:'one-to-many',schemaName:'exp_Report_Line',referencedEntity:'exp_report',referencedAttribute:'exp_reportid',referencingEntity:'exp_line',referencingAttribute:'exp_report',cascade:{Delete:'Restrict'}}]}});
  const wrong=structuredClone(fixed);const action=wrong.postDeployActions[wrong.postDeployActions.length-1] as any;action.structure.relationships[0].referencedAttribute='exp_wrongid';
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){const denied=await check({...input,manifest:wrong,phase});expect(denied.status).toBe('blocked');expect(denied.reasons.join(' ')).toContain('Package relationship');}
  expect(observe).not.toHaveBeenCalled();
  const result=await check({...input,manifest:fixed});expect(result.status).toBe('unavailable');expect(result.reasons.join(' ')).toContain('Supported packaged');
});
it('rejects conflicting packaged column limits at every stage without granting after a declaration repair',async()=>{
  const xml='<Entities><Entity><Name>exp_report</Name><EntityInfo><entity Name="exp_report"><attributes><attribute><LogicalName>exp_code</LogicalName><Type>nvarchar</Type><RequiredLevel>none</RequiredLevel><MaxLength>200</MaxLength><Length>400</Length></attribute></attributes></entity></EntityInfo></Entity></Entities>';
  const input=await packaged(xml,'<RootComponent type="1" schemaName="exp_report" behavior="0"/>');
  const action={id:'schema',type:'schema-check',component:'report',columns:[{name:'exp_code',type:'String',required:'None',constraints:{maxLength:100}}]};
  const approved={...input.manifest,targetComponents:[...input.manifest.targetComponents,{key:'report',kind:'dataverse-table',logicalName:'exp_report'}],postDeployActions:[...input.manifest.postDeployActions,action]};
  const observe=vi.fn(()=>observation());const check=createDeliveryGovernance({observation:observe});
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){const denied=await check({...input,phase,manifest:approved});expect(denied.status).toBe('blocked');expect(denied.reasons[0]).toContain('constraint');}
  expect(observe).not.toHaveBeenCalled();action.columns[0].constraints.maxLength=200;
  expect((await check({...input,manifest:approved})).status).toBe('unavailable');
});

it('holds ambiguous packaged JSON at every lifecycle stage before policy observations',async()=>{
  const input=await packaged('','',false,true),observe=vi.fn(()=>observation()),check=createDeliveryGovernance({observation:observe});
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){const result=await check({...input,phase});expect(result.status).toBe('unavailable');expect(result.packageInventoryFile).toBeDefined();const inventory=JSON.parse(await fs.readFile(path.join(input.evidenceDirectory!,result.packageInventoryFile!),'utf8'));expect(inventory.archiveComplete).toBe(false);expect(inventory.resourceInventoryComplete).toBe(false);}
  expect(observe).not.toHaveBeenCalled();
});
