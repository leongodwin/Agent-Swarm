import {expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import {Swarm} from './swarm.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';

function fixture(){
  const head='b'.repeat(40),merge='c'.repeat(40),source={sha256:'a'.repeat(64),content:{}} as DeliveryRecord;
  const qa={prNumber:8,status:'passed',issueNumber:5,passedSha:head,qaAgentId:'qa',commentUrl:'https://example.test/report',summary:'Independent source/native checks passed',checks:[{name:'Source',result:'pass',details:'Exact stopped source verified'}],taskAuthorityHash:source.sha256,repoId:'test/repo'};
  const evidenceHash=crypto.createHash('sha256').update(JSON.stringify({pr:qa.prNumber,head:qa.passedSha,reviewer:qa.qaAgentId,summary:qa.summary,checks:qa.checks,commentUrl:qa.commentUrl})).digest('hex');
  const receipt={issue:5,taskHash:source.sha256,reviewer:'qa',prNumber:8,headSha:head,mergeCommitSha:merge,evidenceHash,acceptedAt:new Date().toISOString()};
  const pr={number:8,baseRefName:'main',state:'MERGED',headSha:head,mergeCommitSha:merge,closesIssues:[5]};
  const backend={demo:false,prDetails:vi.fn(async()=>pr)};
  const swarm=Object.assign(Object.create(Swarm.prototype),{closed:false,state:{repos:[{id:'test/repo',fullName:'test/repo',defaultBranch:'main'}],qa:[qa]},backend}) as Swarm;
  return {swarm,backend,pr,qa,source,receipt,verify:()=>swarm.verifyAcceptedTask('test/repo',5,source,receipt)};
}
it('revalidates original office QA hash and actual merged PR before allowing reconciliation',async()=>{
  const f=fixture();await expect(f.verify()).resolves.toMatchObject({status:'passed',prNumber:8});expect(await f.verify()).not.toHaveProperty('repoId');expect(f.backend.prDetails).toHaveBeenLastCalledWith('test/repo',8);
});
it.each(['head','merge','base','issue','not-merged'])('rejects changed GitHub %s',async change=>{
  const f=fixture();if(change==='head')f.pr.headSha='d'.repeat(40);if(change==='merge')f.pr.mergeCommitSha='e'.repeat(40);if(change==='base')f.pr.baseRefName='other';if(change==='issue')f.pr.closesIssues=[];if(change==='not-merged')f.pr.state='OPEN';
  await expect(f.verify()).rejects.toThrow(/merged|source/);
});
it('rejects changed QA before native/GitHub reads',async()=>{
  const f=fixture();f.qa.summary='Different independent result';await expect(f.verify()).rejects.toThrow('QA evidence');expect(f.backend.prDetails).not.toHaveBeenCalled();
});
it('rejects QA drift while the GitHub read is in flight',async()=>{
  const f=fixture();f.backend.prDetails.mockImplementationOnce(async()=>{f.qa.summary='Changed during read';return f.pr;});await expect(f.verify()).rejects.toThrow('changed during');
});
it('rejects demo and shutdown rather than carrying a historical pass',async()=>{
  const f=fixture();f.backend.demo=true;await expect(f.verify()).rejects.toThrow('Demo');f.backend.demo=false;
  f.backend.prDetails.mockImplementationOnce(async()=>{Object.assign(f.swarm,{closed:true});return f.pr;});await expect(f.verify()).rejects.toThrow('shutting down');
});

it('reconciles after normal merge removes the active QA row using only exact hash-matching retained proof',async()=>{
  const f=fixture();Object.assign(f.swarm,{state:{repos:[{id:'test/repo',fullName:'test/repo',defaultBranch:'main'}],qa:[]}});
  await expect(f.verify()).rejects.toThrow('QA evidence');
  await expect(f.swarm.verifyAcceptedTask('test/repo',5,f.source,f.receipt,f.qa)).resolves.toMatchObject({status:'passed',prNumber:8});
  await expect(f.swarm.verifyAcceptedTask('test/repo',5,f.source,f.receipt,{...f.qa,summary:'Invented pass'})).rejects.toThrow('QA evidence');
});
