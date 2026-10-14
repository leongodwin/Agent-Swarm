import {expect,it,afterEach} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {healthEvidenceView} from './healthEvidence.ts';
import {unavailableGovernance} from './lifecycleGovernance.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
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
