import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
import {ManualGovernance,manualControls,type ManualRelease} from './manualGovernance.ts';
import type {LifecycleRequest} from './lifecycleGovernance.ts';
const roots:string[]=[];afterEach(async()=>{vi.useRealTimers();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const hash='a'.repeat(64),facts={artifactSha256:hash,policySha256:hash,schemaSha256:hash,inventorySha256:hash,advancedSha256:hash};
const request:LifecycleRequest={phase:'build',sourceCommit:'b'.repeat(40),releaseId:'release',checkout:'unused',environmentUrl:'https://test.crm4.dynamics.com',manifest:{scope:'synthetic'},acceptanceProfile:'functional-development'};
const review={decision:'approved',controls:[...manualControls],notes:'Independent synthetic review of exact package, policy, schema, permissions, licensing and owned-data recovery evidence.'};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'manual-governance-'));roots.push(root);const file=path.join(root,'receipt.json');await fs.writeFile(file,'Synthetic evidence');const evidence=[{file,sha256:crypto.createHash('sha256').update('Synthetic evidence').digest('hex')}];
 const release:ManualRelease={repoId:'test/repo',head:request.sourceCommit,environmentUrl:request.environmentUrl,planHash:hash,plan:{owner:'dev',qaOwner:'qa',acceptanceProfile:'functional-development'}};
 const implementation={sha256:hash,evidence};const store=new ManualGovernance(root,()=>release,()=>{},implementation);await store.init();return {root,file,evidence,release,store,implementation};}
it('requires independent review of exact bytes and pins approvals to phase, source and facts',async()=>{
 const f=await fixture();expect(await f.store.observe(request,facts,f.evidence)).toBeUndefined();const row=f.store.view('test/repo')[0];
 await expect(f.store.review('test/repo',row.id,'dev',review)).rejects.toThrow('independent QA');
 await expect(f.store.review('other/repo',row.id,'qa',review)).rejects.toThrow('not found');
 await f.store.review('test/repo',row.id,'qa',review);expect(await f.store.observe(request,facts,f.evidence)).toMatchObject({status:'clear',assurance:'manual-functional-development',manualAssessmentId:row.id});
 expect(await f.store.observe({...request,phase:'import'},facts,f.evidence)).toBeUndefined();
 expect(await f.store.observe(request,{...facts,artifactSha256:'c'.repeat(64)},f.evidence)).toBeUndefined();
 expect(await f.store.observe({...request,acceptanceProfile:'production'},facts,f.evidence)).toBeUndefined();
 f.release.head='c'.repeat(40);expect(await f.store.observe(request,facts,f.evidence)).toBeUndefined();
});
it('denies changed evidence, cancellation and expired reviews, including after restart',async()=>{
 const f=await fixture();await f.store.observe(request,facts,f.evidence);const row=f.store.view('test/repo')[0];
 await fs.writeFile(f.file,'Changed evidence');await expect(f.store.review('test/repo',row.id,'qa',review)).rejects.toThrow('evidence changed');
 await fs.writeFile(f.file,'Synthetic evidence');let calls=0;await expect(f.store.review('test/repo',row.id,'qa',review,()=>{if(++calls>1)throw new Error('Session cancelled');})).rejects.toThrow('Session cancelled');expect(f.store.view('test/repo')[0].review).toBeUndefined();
 await f.store.review('test/repo',row.id,'qa',review);await f.store.close();const restarted=new ManualGovernance(f.root,()=>f.release,()=>{},f.implementation);await restarted.init();expect(await restarted.observe(request,facts,f.evidence)).toMatchObject({status:'clear'});
 vi.useFakeTimers();vi.setSystemTime(Date.parse(row.expiresAt));expect(await restarted.observe(request,facts,f.evidence)).toBeUndefined();
});
it('preserves and refuses corrupted persisted authority',async()=>{
 const f=await fixture();await f.store.observe(request,facts,f.evidence);await f.store.close();const file=path.join(f.root,'manual-governance.json'),data=JSON.parse(await fs.readFile(file,'utf8'));data.assessments[0].facts.artifactSha256='c'.repeat(64);await fs.writeFile(file,JSON.stringify(data));
 await expect(new ManualGovernance(f.root,()=>f.release,()=>{},f.implementation).init()).rejects.toThrow('inconsistent');
});
