import {expect,it,afterEach} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {healthEvidenceView} from './healthEvidence.ts';
import {unavailableGovernance} from './lifecycleGovernance.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
import crypto from 'node:crypto';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
async function fixture(){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-health-evidence-'));roots.push(home);
  const run={id:'synthetic-run',releaseId:'synthetic-release',repoId:'synthetic/repo',head:'a'.repeat(40),environmentUrl:'https://synthetic.crm4.dynamics.com',phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:['release.json'],log:[],health:{status:'degraded',nextCheckAt:new Date().toISOString(),governanceEvidence:'health/governance-0-health.json'}} as DeliveryRun;
  const root=path.join(home,'delivery-runs',run.id,'health');await fs.mkdir(root,{recursive:true});
  const value=unavailableGovernance({phase:'health',sourceCommit:run.head,environmentUrl:run.environmentUrl,releaseId:run.releaseId!,checkout:'synthetic',manifest:{}}),file=path.join(root,'governance-0-health.json');await fs.writeFile(file,JSON.stringify(value));
  return {home,run,root,value,file};
}
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
