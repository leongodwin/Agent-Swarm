import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {verifyStandaloneQuarantine} from './standaloneProbeQuarantine.ts';
import {standaloneProbeFixturePlan} from './testFixtures/standaloneProbe.ts';
import {connectorProbeDigest} from './connectorMetadataProbe.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('as-standalone-fence-'))throw Error('Unexpected cleanup target');await fs.rm(root,{recursive:true,force:true});}});
const digest=(data:string|Uint8Array)=>crypto.createHash('sha256').update(data).digest('hex');
async function fixture(){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'as-standalone-fence-'));roots.push(home);const plan=standaloneProbeFixturePlan(),repo='synthetic/probe',owner='c'.repeat(64),pid=2147483647,stamp=new Date(Date.now()-7200000).toISOString();
 const scope=connectorProbeDigest({tenant:plan.identity.tenantId,environment:plan.identity.environmentId,repo,record:plan.record.id}),resource='connector-probe:'+scope,root=path.join(home,'planning','connector-probe-executions',scope);await fs.mkdir(root,{recursive:true});await fs.mkdir(path.join(home,'resource-leases'));
 const names=['000-create-publishers-intent.json','001-created-publishers.json','002-create-solutions-intent.json','003-created-solutions.json','004-create-connectionreferences-intent.json','005-created-connectionreferences.json','006-create-flow-intent.json','007-created-flow.json','008-add-membership-intent.json','intent.json'];
 const rows:any[]=names.map(()=>({proposalSha256:owner}));rows[7]={...rows[7],stage:'created-flow',flowId:plan.quarantine.flowId,publisherId:plan.quarantine.publisherId,solutionId:plan.quarantine.solutionId,referenceId:plan.quarantine.referenceId};rows[8]={...rows[8],stage:'add-membership-intent',ComponentId:plan.quarantine.flowId,ComponentType:29,SolutionUniqueName:'ASRecruitmentE2E',AddRequiredComponents:false,solutionId:plan.quarantine.solutionId};rows[9]={...rows[9],record:{id:plan.record.id},businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false,releaseStartedAt:stamp,startedAt:stamp,pid};
 const files=[];for(let i=0;i<names.length;i++){const text=JSON.stringify(rows[i]);await fs.writeFile(path.join(root,names[i]),text);files.push({name:names[i],sha256:digest(text)});}
 const lease={resource,owner,pid,acquiredAt:stamp},leaseFile=path.join(home,'resource-leases',digest(resource)+'.json'),leaseText=JSON.stringify(lease);await fs.writeFile(leaseFile,leaseText);plan.quarantine.leaseSha256=digest(leaseText);
 const index={scope,resource,files,lease:{...lease,sha256:plan.quarantine.leaseSha256}},indexFile=path.join(home,'original-probe-failure-index.json');
 const saveIndex=async()=>{const text=JSON.stringify(index);await fs.writeFile(indexFile,text);plan.quarantine.indexSha256=digest(text);};await saveIndex();
 return {home,plan,repo,root,index,indexFile,leaseFile,saveIndex,rows,names,async changeRow(i:number){const text=JSON.stringify(rows[i]);await fs.writeFile(path.join(root,names[i]),text);index.files[i].sha256=digest(text);await saveIndex();}};
}
it('reads every original file and hold without rewriting, releasing or asserting provider settlement',async()=>{
 const f=await fixture(),before=await fs.readFile(f.leaseFile),proof=await verifyStandaloneQuarantine(f.plan,f.home,f.repo);
 expect(proof).toMatchObject({originalHoldPreserved:true,providerMembershipSettlementVerified:false,replayAuthorized:false,tenantAuthorityGranted:false,originalActivationOrTriggerIntent:false});
 expect(await fs.readFile(f.leaseFile)).toEqual(before);expect(await fs.readdir(f.root)).toHaveLength(10);
});
it.each(['index','journal','lease','extra-trigger','namespace','identity','stage','proposal','window','live-owner','hardlink'] as const)('holds on %s drift or ambiguity',async mode=>{
 const f=await fixture();
 if(mode==='index')await fs.appendFile(f.indexFile,' ');
 if(mode==='journal')await fs.appendFile(path.join(f.root,f.names[0]),' ');
 if(mode==='lease')await fs.appendFile(f.leaseFile,' ');
 if(mode==='extra-trigger')await fs.writeFile(path.join(f.root,'009-trigger-intent.json'),'{}');
 if(mode==='identity'){f.rows[7].flowId='22222222-2222-4222-8222-222222222222';await f.changeRow(7);}
 if(mode==='stage'){f.rows[8].stage='activation-intent';await f.changeRow(8);}
 if(mode==='proposal'){f.rows[0].proposalSha256='d'.repeat(64);await f.changeRow(0);}
 if(mode==='window'){f.rows[9].releaseStartedAt=new Date().toISOString();await f.changeRow(9);}
 if(mode==='live-owner'){const lease=JSON.parse(await fs.readFile(f.leaseFile,'utf8'));lease.pid=process.pid;const text=JSON.stringify(lease);await fs.writeFile(f.leaseFile,text);f.plan.quarantine.leaseSha256=digest(text);f.index.lease.pid=process.pid;f.index.lease.sha256=digest(text);f.rows[9].pid=process.pid;await f.changeRow(9);}
 if(mode==='hardlink')await fs.link(f.indexFile,path.join(f.home,'other-index.json'));
 await expect(verifyStandaloneQuarantine(f.plan,f.home,mode==='namespace'?'other/repo':f.repo)).rejects.toThrow();
 expect(await fs.stat(f.leaseFile)).toBeTruthy();
});
