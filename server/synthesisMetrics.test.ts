import {expect,it} from 'vitest';
import {synthesisSummary} from './synthesisMetrics.ts';
import {synthesisJobSchema,type SynthesisJob} from '../shared/hldSynthesis.ts';
const now=Date.parse('2026-10-13T12:00:00Z');
const row=(status:SynthesisJob['status'],elapsedMs=1000):SynthesisJob=>({id:'11111111-1111-4111-8111-111111111111',repoId:'synthetic',status,runtime:'codex-cli',startedAt:now-10000,endedAt:now-10000+elapsedMs,elapsedMs,deadlineMs:300000,costUsd:0,turns:0,events:[],...(status==='completed'?{result:{docId:'HLD-11111111-1111-4111-8111-111111111111',artifactSha256:'a'.repeat(64)}}:{})});
it('keeps failures and exclusions explicit instead of inferring latency reliability from successes',()=>{
  const jobs=[row('completed',1000),row('completed',3000),row('failed'),row('blocked'),row('cancelled'),{...row('running'),runtimeCleanup:'awaiting-completion' as const},{...row('completed'),runtime:'claude-sdk' as const}];
  const value=synthesisSummary(jobs,now-1000,now);expect(value.recorded).toEqual({completed:2,failed:1,blocked:1,cancelled:1,active:1,awaitingCleanup:1,legacyProviderJobs:1});expect(value.successfulDurationMs).toEqual({count:2,median:2000,p95:3000});expect(value.recordedCompletionPercent).toBe(40);expect(value.completeWindowCompletionPercent).toBeNull();
});
it('does not manufacture a zero or 100 percent result for absent or out-of-window jobs',()=>{
  const value=synthesisSummary([{...row('completed'),startedAt:now+1},{...row('completed'),startedAt:now-31*86400000}],now-31*86400000,now);expect(value.completeWindow).toBe(true);expect(value.completeWindowCompletionPercent).toBeNull();expect(value.successfulDurationMs).toEqual({count:0,median:null,p95:null});
  expect(synthesisSummary([row('completed')],now-31*86400000,now).completeWindowCompletionPercent).toBe(100);
});
it('rejects inconsistent successful duration records before they can become timing evidence',()=>{
  for(const changed of [{elapsedMs:10},{endedAt:now-11000},{elapsedMs:300000,endedAt:now-10000+300000}])expect(synthesisJobSchema.safeParse({...row('completed'),...changed}).success).toBe(false);
  expect(synthesisJobSchema.safeParse(row('completed')).success).toBe(true);
});
