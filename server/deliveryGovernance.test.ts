import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {ZipFile} from 'yazl';
import {createDeliveryGovernance} from './deliveryGovernance.ts';
import type {LifecycleRequest} from './lifecycleGovernance.ts';
import {manifestDigest} from './lifecycleGovernance.ts';
import type {DeclaredSchemaObservation} from './declaredSchema.ts';
const guid='11111111-1111-4111-8111-111111111111';
const manifest={schemaVersion:1,solutionUniqueName:'Expenses',solutionVersion:'1.0.0.0',solutionZip:'release.zip',hasUi:false,recovery:{runbook:'recovery.md',rehearsalReport:'drill.json'},documentation:['one.md','two.md','three.md'],build:[{executable:'node',args:['build.js']}],test:[{executable:'node',args:['test.js']}],verify:[{executable:'node',args:['verify.js']}],targetBinding:{organizationId:guid,userId:guid},platformIdentity:{tenantId:guid,username:'tester@company.test',environmentId:guid},targetComponents:[{key:'dataverse',kind:'connection-reference',logicalName:'exp_dataverse'}],postDeployActions:[{id:'binding',type:'connection-reference-check',component:'dataverse',connectionId:'approved',connectorId:'shared_commondataserviceforapps'}]};
const request:LifecycleRequest={phase:'build',sourceCommit:'a'.repeat(40),environmentUrl:'https://test.crm4.dynamics.com',releaseId:'release-1',checkout:'unused',manifest};
const observation=(policies:unknown[]=[])=>({schemaVersion:1,tenantId:guid,caller:'tester@company.test',observedAt:new Date().toISOString(),source:'Get-DlpPolicy module route',moduleVersion:'2.0.219',scope:'standard-policy-inventory',complete:true,pages:1,policies});
const directories:string[]=[];afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>fs.rm(directory,{recursive:true,force:true})));});
async function packaged() {
  const checkout=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-governed-package-'));directories.push(checkout);const evidenceDirectory=path.join(checkout,'evidence');
  const definition = {
    triggers: { tick: { type: 'Recurrence' } },
    actions: {
      query: { type: 'OpenApiConnection', inputs: { host: { connectionName: 'dv', apiId: 'shared_commondataserviceforapps', operationId: 'ListRecords' } } },
      mail: { type: 'OpenApiConnection', inputs: { host: { connectionName: 'mail', apiId: 'shared_office365', operationId: 'SendEmailV2' } } },
    },
  };
  const connectionReferences = {
    dv: { api: { name: 'shared_commondataserviceforapps' }, connection: { connectionReferenceLogicalName: 'exp_dataverse' } },
    mail: { api: { name: 'shared_office365' }, connection: { connectionReferenceLogicalName: 'exp_outlook' } },
  };
  const entries = {
    'solution.xml': `<ImportExportXml><SolutionManifest><UniqueName>Expenses</UniqueName><Version>1.0.0.0</Version><Managed>0</Managed><RootComponents><RootComponent type="29" id="{${guid}}"/></RootComponents></SolutionManifest></ImportExportXml>`,
    'customizations.xml': `<ImportExportXml><connectionreferences><connectionreference connectionreferencelogicalname="exp_dataverse"><connectorid>shared_commondataserviceforapps</connectorid></connectionreference><connectionreference connectionreferencelogicalname="exp_outlook"><connectorid>shared_office365</connectorid></connectionreference></connectionreferences><Workflows><Workflow WorkflowId="{${guid}}"><Category>5</Category><JsonFileName>/Workflows/flow.json</JsonFileName></Workflow></Workflows></ImportExportXml>`,
    'Workflows/flow.json': JSON.stringify({ properties: { connectionReferences, definition } }),
  };
  const archive=new ZipFile();const chunks:Buffer[]=[];const bytes=new Promise<Buffer>((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});for(const [name,body] of Object.entries(entries))archive.addBuffer(Buffer.from(body),name,{compress:false});archive.end();const buffer=await bytes;await fs.writeFile(path.join(checkout,'release.zip'),buffer);
  return {...request,phase:'import' as const,checkout,evidenceDirectory,packageSha256:crypto.createHash('sha256').update(buffer).digest('hex'),manifest:{...manifest,targetComponents:[...manifest.targetComponents,{key:'outlook',kind:'connection-reference',logicalName:'exp_outlook'},{key:'flow',kind:'cloud-flow',logicalName:guid}],postDeployActions:[...manifest.postDeployActions,{id:'outlook-binding',type:'connection-reference-check',component:'outlook',connectionId:'approved-mail',connectorId:'shared_office365'}]}};
}
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
it('rejects package drift and omitted components/bindings while keeping unsupported overall acceptance unavailable',async()=>{
  const input=await packaged();const check=createDeliveryGovernance({observation:()=>observation()});
  expect((await check({...input,packageSha256:'f'.repeat(64)})).status).toBe('unavailable');
  expect((await check({...input,manifest:{...input.manifest,solutionVersion:'2.0.0.0'}})).status).toBe('blocked');
  expect((await check({...input,manifest:{...input.manifest,targetComponents:input.manifest.targetComponents.filter(component=>component.key!=='flow')}})).status).toBe('blocked');
  const missing=await check({...input,manifest:{...input.manifest,targetComponents:input.manifest.targetComponents.filter(component=>component.key!=='outlook'),postDeployActions:input.manifest.postDeployActions.filter(action=>action.component!=='outlook')}});expect(missing.status).toBe('blocked');expect(missing.reasons[0]).toContain('exp_outlook');
  const ready=await check(input);expect(ready.status).toBe('unavailable');expect(ready.reasons[0]).toContain('Inspectable package resources');expect(ready.reasons[0]).toContain('unverified');
});
