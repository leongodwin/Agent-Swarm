import {expect,it,vi} from 'vitest';
import {observeWorkflowReliability,WorkflowReliabilityService} from './workflowReliability.ts';
const repo='owner/project',now=Date.parse('2026-10-13T12:00:00Z'),identity={id:7,full_name:repo};
const run=(id=1,overrides:Record<string,unknown>={})=>({id,workflow_id:12,run_attempt:1,head_sha:'a'.repeat(40),name:'CI',status:'completed',conclusion:'success' as string|null,created_at:'2026-10-12T12:00:00Z',updated_at:'2026-10-12T12:05:00Z',repository:identity,...overrides});
function reader(runs:ReturnType<typeof run>[],older:unknown=run(1,{conclusion:'failure'})){
  return vi.fn(async(resource:string):Promise<unknown>=>resource==='user'?{id:123}:resource===`repos/${repo}`?identity:resource.includes('/attempts/')?older:{total_count:runs.length,workflow_runs:runs});
}
it('counts failed first attempts rather than reporting only a successful rerun',async()=>{
  const read=reader([run(1,{run_attempt:2})]);const result=await observeWorkflowReliability(repo,read,now);
  expect(result).toMatchObject({status:'observed',complete:true,completed:2,successful:1,unsuccessful:1,successPercent:50,observedMeetsTarget:false,rerunAttempts:1});
  expect(result.failures[0]).toMatchObject({attempt:1,conclusion:'failure',url:'https://github.com/owner/project/actions/runs/1/attempts/1'});
  expect(read.mock.calls.some(([resource])=>resource.endsWith('/attempts/1'))).toBe(true);expect(result.reason).toContain('tenant integration');expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
});
it('keeps active and non-success conclusions distinct and never invents a rate for empty history',async()=>{
  const result=await observeWorkflowReliability(repo,reader([run(1,{status:'in_progress',conclusion:null}),run(2,{conclusion:'cancelled'}),run(3,{conclusion:'skipped'}),run(4)]),now);
  expect(result).toMatchObject({active:1,completed:3,successful:1,unsuccessful:2});
  expect(await observeWorkflowReliability(repo,reader([]),now)).toMatchObject({status:'observed',completed:0,successPercent:null,observedMeetsTarget:null});
});
it.each(['attempt-id','attempt-number','workflow','head','repository','active-old-attempt'])('denies mismatched %s attempt evidence',async mode=>{
  const older=run(1,{conclusion:'failure'});if(mode==='attempt-id')older.id=9;if(mode==='attempt-number')older.run_attempt=2;if(mode==='workflow')older.workflow_id=99;if(mode==='head')older.head_sha='b'.repeat(40);if(mode==='repository')older.repository={...identity,id:99};if(mode==='active-old-attempt'){older.status='queued';older.conclusion=null;}
  expect(await observeWorkflowReliability(repo,reader([run(1,{run_attempt:2})],older),now)).toMatchObject({status:'unavailable',complete:false,successPercent:null});
});
it.each([{total_count:1000,workflow_runs:[]},{total_count:2,workflow_runs:[run()]},{total_count:2,workflow_runs:[run(),run()]},{total_count:1,workflow_runs:[run(1,{created_at:'2026-01-01T00:00:00Z'})]},{total_count:1,workflow_runs:[run(1,{conclusion:'unknown'})]}])('rejects capped, partial, duplicate and invalid history: %j',async page=>{
  const read=reader([]);read.mockImplementation(async resource=>resource==='user'?{id:123}:resource===`repos/${repo}`?identity:page);
  expect((await observeWorkflowReliability(repo,read,now)).status).toBe('unavailable');
});
it.each(['history','identity'])('rejects changing %s during collection',async mode=>{
  let pages=0,users=0;const read=reader([run()]);read.mockImplementation(async resource=>resource==='user'?{id:++users>1&&mode==='identity'?456:123}:resource===`repos/${repo}`?identity:{total_count:1,workflow_runs:[run(1,{conclusion:++pages>1&&mode==='history'?'failure':'success'})]});
  expect((await observeWorkflowReliability(repo,read,now)).status).toBe('unavailable');
});
it('requires complete stable pagination and keeps binding identity private',async()=>{
  const rows=Array.from({length:101},(_,index)=>run(index+1));const read=vi.fn(async resource=>resource==='user'?{id:123,privateToken:'secret'}:resource===`repos/${repo}`?identity:{total_count:101,workflow_runs:resource.endsWith('page=1')?rows.slice(0,100):rows.slice(100)});
  const result=await observeWorkflowReliability(repo,read,now);expect(result).toMatchObject({status:'observed',completed:101,successPercent:100});expect(JSON.stringify(result)).not.toContain('secret');
});
it('rejects invalid resource names and provider errors without leaking credentials',async()=>{
  const read=vi.fn(async()=>{throw new Error('private token');});for(const value of ['../escape','owner/..','owner/project?token=x'])expect((await observeWorkflowReliability(value,read,now)).status).toBe('unavailable');expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(await observeWorkflowReliability(repo,read,now))).not.toContain('private token');
});
it('shares one bounded observation, caches only observed data and returns isolated copies',async()=>{
  let clock=now;const read=reader([run()]);const service=new WorkflowReliabilityService(read,()=>clock);
  const [one,two]=await Promise.all([service.observe(repo),service.observe(repo)]);expect(read).toHaveBeenCalledTimes(6);one.failures.push({runId:1,attempt:1,name:'fake',conclusion:'fake',url:'fake',headSha:'fake'});expect(two.failures).toEqual([]);expect((await service.observe(repo)).failures).toEqual([]);expect(read).toHaveBeenCalledTimes(6);clock+=60001;await service.observe(repo);expect(read).toHaveBeenCalledTimes(12);
  read.mockRejectedValue(new Error('auth'));clock+=60001;await service.observe(repo);const count=read.mock.calls.length;await service.observe(repo);expect(read.mock.calls.length).toBeGreaterThan(count);
});
it('compares the exact 99.5 percent boundary without certifying future reliability',async()=>{
  const rows=Array.from({length:200},(_,index)=>run(index+1,{conclusion:index===0?'failure':'success'}));
  const read=vi.fn(async resource=>resource==='user'?{id:123}:resource===`repos/${repo}`?identity:{total_count:200,workflow_runs:resource.endsWith('page=1')?rows.slice(0,100):rows.slice(100)});
  expect(await observeWorkflowReliability(repo,read,now)).toMatchObject({successPercent:99.5,observedMeetsTarget:true});rows[1].conclusion='failure';
  expect(await observeWorkflowReliability(repo,read,now)).toMatchObject({successPercent:99,observedMeetsTarget:false});
});
it('refuses attempt-count overload and expired read admission rather than returning partial statistics',async()=>{
  const overloaded=Array.from({length:41},(_,index)=>run(index+1,{run_attempt:50}));const read=reader(overloaded);expect((await observeWorkflowReliability(repo,read,now)).status).toBe('unavailable');expect(read.mock.calls.some(([resource])=>resource.includes('/attempts/'))).toBe(false);
  let clock=now;const bounded=new WorkflowReliabilityService(reader([run()]),()=>{clock+=30000;return clock;});expect((await bounded.observe(repo)).status).toBe('unavailable');
});
