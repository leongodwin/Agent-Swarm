import {expect,it,afterEach} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {healthEvidenceView,readHealthEvidenceArtifact} from './healthEvidence.ts';
import {vi} from 'vitest';
import {unavailableGovernance} from './lifecycleGovernance.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
import crypto from 'node:crypto';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
async function fixture(){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-health-evidence-'));roots.push(home);
  const run={id:'synthetic-run',releaseId:'synthetic-release',repoId:'synthetic/repo',head:'a'.repeat(40),environmentUrl:'https://synthetic.crm4.dynamics.com',phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:['release.json'],log:[],health:{status:'degraded',nextCheckAt:new Date().toISOString(),governanceEvidence:'health/governance-0-health.json'}} as DeliveryRun;
  const root=path.join(home,'delivery-runs',run.id,'health');await fs.mkdir(root,{recursive:true});
  const value=unavailableGovernance({phase:'health',sourceCommit:run.head,environmentUrl:run.environmentUrl,releaseId:run.releaseId!,checkout:'synthetic',manifest:{}}),file=path.join(root,'governance-0-health.json');await fs.writeFile(file,JSON.stringify(value));
  return {home,run,root,value,file};
}
async function artifactFixture(kind:'package'|'advanced-policy'|'connector-catalogue'){
  const f=await fixture(),tenant='11111111-1111-4111-8111-111111111111';f.value.artifactSha256='d'.repeat(64);
  const identity={tenantId:tenant,caller:'tester@company.test',environmentId:tenant},stamp=f.value.checkedAt;
  const advanced={...identity,scope:'environment-rule-assignment-inventory',accountScope:'azure-cli-profile',complete:false,complianceVerified:false,status:'unavailable',checkedAt:stamp,reason:'Synthetic policy metadata unavailable',assignments:[],policies:[]};
  const catalogue={...identity,scope:'requested-connector-catalogue',accountScope:'azure-cli-profile',complete:false,complianceVerified:false,operationIdsVerified:false,status:'unavailable',checkedAt:stamp,requested:['shared_office365'],entries:[],failure:'delegated-permissions',elapsedMs:10,nativeCommands:2,reason:'Synthetic catalogue unavailable'};
  const value:any=kind==='package'?{schemaVersion:1,scope:'package-metadata-inventory',packageSha256:f.value.artifactSha256,archiveComplete:true,resourceInventoryComplete:false,complianceVerified:false}:kind==='advanced-policy'?advanced:{schemaVersion:1,scope:'package-connector-catalogue-observation',phase:'health',sourceCommit:f.run.head,releaseId:f.run.releaseId,environmentUrl:f.run.environmentUrl,manifestSha256:f.value.manifestSha256,packageSha256:f.value.artifactSha256,observation:catalogue};
  const content=JSON.stringify(value),file=kind==='package'?`package-inventory-${f.value.artifactSha256}.json`:`${kind}-${crypto.createHash('sha256').update(content).digest('hex')}.json`;
  if(kind==='package'){f.value.packageInventoryFile=file;f.value.packageInventorySha256=crypto.createHash('sha256').update(content).digest('hex');}else if(kind==='advanced-policy')f.value.advancedPolicyFile=file;else f.value.connectorCatalogueFile=file;
  await fs.writeFile(path.join(f.root,file),content);await fs.writeFile(f.file,JSON.stringify(f.value));return {...f,artifact:file,content,artifactValue:value};
}
it.each(['package','advanced-policy','connector-catalogue'] as const)('returns captured verified %s bytes and refuses later mutation including a BOM',async kind=>{
  const f=await artifactFixture(kind),context=await healthEvidenceView(f.home,f.run),bytes=await readHealthEvidenceArtifact(context,f.artifact);
  expect(bytes).toEqual(Buffer.from(f.content));await fs.writeFile(path.join(f.root,f.artifact),'private modified bytes');expect(bytes.toString()).toBe(f.content);
  await expect(readHealthEvidenceArtifact(context,f.artifact)).rejects.toThrow('could not be verified');await fs.writeFile(path.join(f.root,f.artifact),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]));await expect(readHealthEvidenceArtifact(context,f.artifact)).rejects.toThrow('could not be verified');
});
it('keeps a legacy package decision readable but denies an inventory without a recorded content digest',async()=>{
  const f=await artifactFixture('package');delete f.value.packageInventorySha256;await fs.writeFile(f.file,JSON.stringify(f.value));const context=await healthEvidenceView(f.home,f.run);expect(context.view.files).toContainEqual({file:f.artifact,kind:'package'});await expect(readHealthEvidenceArtifact(context,f.artifact)).rejects.toThrow('could not be verified');
});
it('rejects changed decision bytes even when its release identifiers and pointer remain the same',async()=>{
  const f=await artifactFixture('advanced-policy'),context=await healthEvidenceView(f.home,f.run);await fs.writeFile(f.file,JSON.stringify({...f.value,reasons:['Changed decision']}));
  await expect(readHealthEvidenceArtifact(context,f.artifact)).rejects.toThrow('could not be verified');await expect(readHealthEvidenceArtifact(context,'governance-0-health.json')).rejects.toThrow('could not be verified');
});
it('rechecks the decision after an artifact read and rejects changes during that read',async()=>{
  const f=await artifactFixture('advanced-policy'),context=await healthEvidenceView(f.home,f.run),handle=await fs.open(path.join(f.root,f.artifact),'r'),original=handle.read.bind(handle);
  vi.spyOn(fs,'open').mockResolvedValueOnce(handle);vi.spyOn(handle,'read').mockImplementationOnce(async(...args:any[])=>{await fs.writeFile(f.file,JSON.stringify({...f.value,reasons:['Changed during read']}));return (original as any)(...args);});
  await expect(readHealthEvidenceArtifact(context,f.artifact)).rejects.toThrow('could not be verified');
});
it.each(['head','phase','release','environment','manifest','package','stale','future'])('rejects a correctly hashed catalogue receipt with wrong %s context',async fault=>{
  const f=await artifactFixture('connector-catalogue'),value=f.artifactValue;if(fault==='head')value.sourceCommit='b'.repeat(40);if(fault==='phase')value.phase='verify';if(fault==='release')value.releaseId='other';if(fault==='environment')value.environmentUrl='https://other.crm4.dynamics.com';if(fault==='manifest')value.manifestSha256='b'.repeat(64);if(fault==='package')value.packageSha256='b'.repeat(64);if(fault==='stale')value.observation.checkedAt=new Date(Date.parse(f.value.checkedAt)-61000).toISOString();if(fault==='future')value.observation.checkedAt=new Date(Date.parse(f.value.checkedAt)+31000).toISOString();
  const content=JSON.stringify(value),file=`connector-catalogue-${crypto.createHash('sha256').update(content).digest('hex')}.json`;
  const decision=JSON.parse(await fs.readFile(f.file,'utf8'));decision.connectorCatalogueFile=file;await fs.writeFile(f.file,JSON.stringify(decision));await fs.writeFile(path.join(f.root,file),content);
  await expect(readHealthEvidenceArtifact(await healthEvidenceView(f.home,f.run),file)).rejects.toThrow('could not be verified');
});
it('keeps older health observations readable without presenting them as a new release approval',async()=>{
  const f=await fixture();f.value.checkedAt=new Date(Date.now()-86400000).toISOString();await fs.writeFile(f.file,JSON.stringify(f.value));const result=await healthEvidenceView(f.home,f.run);expect(result.view).toMatchObject({status:'unavailable',checkedAt:f.value.checkedAt,files:[{kind:'decision',file:'governance-0-health.json'}]});expect(f.run.evidence).toEqual(['release.json']);
});

async function schemaFixture(){
  const f=await fixture();
  const schema:any={scope:'declared-target-schema',complete:false,status:'unavailable',phase:'health',sourceCommit:f.run.head,releaseId:f.run.releaseId,environmentUrl:f.run.environmentUrl,manifestSha256:f.value.manifestSha256,checkedAt:f.value.checkedAt,reason:'Declared schema check failed at columns (validation). Compare target metadata.',tables:[],observations:[],diagnostic:{stage:'columns',failure:'validation',elapsedMs:1129,nativeCommands:4,metadataReads:1,responseBytes:900}};
  const save=async(value=schema)=>{const content=JSON.stringify(value,null,2),name=`declared-schema-${crypto.createHash('sha256').update(content).digest('hex')}.json`;await fs.writeFile(path.join(f.root,name),content);await fs.writeFile(f.file,JSON.stringify({...f.value,declaredSchemaFile:name}));return name;};
  await save();return {...f,schema,save};
}
it('surfaces only digest- and context-bound schema diagnostics while retaining historical observation times',async()=>{
  const f=await schemaFixture();f.value.checkedAt=new Date(Date.now()-86400000).toISOString();f.schema.checkedAt=f.value.checkedAt;const name=await f.save();
  const result=await healthEvidenceView(f.home,f.run);expect(result.view.schema).toEqual({status:'unavailable',checkedAt:f.schema.checkedAt,reason:f.schema.reason,diagnostic:f.schema.diagnostic});expect(result.view.files).toContainEqual({file:name,kind:'schema'});expect(result.view.status).toBe('unavailable');
});
it.each(['digest','phase','head','release','environment','manifest','stale-at-decision','future-at-decision','contradictory','partial-facts','malformed','missing'])('hides %s diagnostics while keeping the scoped lifecycle decision readable',async fault=>{
  const f=await schemaFixture();
  if(fault==='phase')f.schema.phase='verify';if(fault==='head')f.schema.sourceCommit='b'.repeat(40);if(fault==='release')f.schema.releaseId='other';if(fault==='environment')f.schema.environmentUrl='https://other.crm4.dynamics.com';if(fault==='manifest')f.schema.manifestSha256='b'.repeat(64);
  if(fault==='stale-at-decision')f.schema.checkedAt=new Date(Date.parse(f.value.checkedAt)-61000).toISOString();if(fault==='future-at-decision')f.schema.checkedAt=new Date(Date.parse(f.value.checkedAt)+31000).toISOString();
  if(fault==='contradictory')f.schema.diagnostic.failure='none';if(fault==='partial-facts')f.schema.tables=['exp_secret'];
  const name=await f.save();if(fault==='digest'||fault==='malformed')await fs.writeFile(path.join(f.root,name),'private modified contents');if(fault==='missing')await fs.unlink(path.join(f.root,name));
  const result=await healthEvidenceView(f.home,f.run);expect(result.view.schema).toEqual({status:'evidence-unavailable'});expect(result.view.status).toBe('unavailable');expect(JSON.stringify(result.view)).not.toContain('private modified');expect(JSON.stringify(result.view)).not.toContain('exp_secret');
});
it.each(['head','environment','release','phase','unsafe-artifact','malformed','oversized','missing'])('denies %s health evidence with a safe error',async fault=>{
  const f=await fixture(),value:any={...f.value};
  if(fault==='head')value.sourceCommit='b'.repeat(40);if(fault==='environment')value.environmentUrl='https://other.crm4.dynamics.com';if(fault==='release')value.releaseId='other';if(fault==='phase')value.phase='verify';if(fault==='unsafe-artifact')value.advancedPolicyFile='../private';
  if(fault==='missing')await fs.unlink(f.file);else await fs.writeFile(f.file,fault==='malformed'?'private invalid text':fault==='oversized'?'x'.repeat(65537):JSON.stringify(value));
  await expect(healthEvidenceView(f.home,f.run)).rejects.toThrow('Current health governance evidence is unavailable');
});
it.each(['id','pointer','unscoped'])('rejects unsafe or unscoped %s before reading a health file',async fault=>{
  const f=await fixture();if(fault==='id')f.run.id='../private';if(fault==='pointer')f.run.health!.governanceEvidence='health/../private';if(fault==='unscoped')delete f.run.releaseId;
  await expect(healthEvidenceView(f.home,f.run)).rejects.toThrow('Current health governance evidence is unavailable');
});
