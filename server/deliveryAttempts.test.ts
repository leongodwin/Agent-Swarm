import {expect,it} from 'vitest';
import {deliveryAttemptSummary,attemptHistorySchema} from './deliveryAttempts.ts';
import type {DeliveryAttempt,DeliveryAttemptHistory} from '../shared/delivery.ts';
const now=Date.parse('2026-10-13T12:00:00Z');
const attempt=(status:DeliveryAttempt['status'],n:number):DeliveryAttempt=>({id:`11111111-1111-4111-8111-${n.toString(16).padStart(12,'0')}`,releaseId:'release',repoId:'owner/repo',head:'a'.repeat(40),environmentUrl:'https://target.crm4.dynamics.com',startedAt:'2026-10-12T12:00:00Z',status,...(['successful','failed','interrupted','superseded'].includes(status)?{endedAt:'2026-10-12T12:01:00Z'}:{}),acceptanceProfile:'production'});
it('keeps failed attempts in the denominator after a successful retry and separates review/active work',()=>{
  const history:DeliveryAttemptHistory={version:1,startedAt:'2026-09-01T12:00:00Z',legacyRunIds:[],attempts:['failed','successful','reviewing','running','preparing','interrupted','superseded'].map((status,i)=>attempt(status as DeliveryAttempt['status'],i))};
  const result=deliveryAttemptSummary(history,[],undefined,now);expect(result.completeWindow).toBe(true);expect(result.recorded).toEqual({completed:4,successful:1,unsuccessful:3,active:2,awaitingReview:1,successPercent:25});expect(result.successPercent).toBe(25);expect(result.observedMeetsTarget).toBe(false);
});
it('never calls partial or empty history a complete success rate',()=>{
  const history:DeliveryAttemptHistory={version:1,startedAt:'2026-10-12T12:00:00Z',legacyRunIds:[],attempts:[attempt('successful',1)]};
  expect(deliveryAttemptSummary(history,[],undefined,now)).toMatchObject({completeWindow:false,successPercent:null,observedMeetsTarget:null,recorded:{successPercent:100}});
  expect(deliveryAttemptSummary({...history,startedAt:'2026-09-01T12:00:00Z',attempts:[]},[],undefined,now)).toMatchObject({completeWindow:true,successPercent:null,observedMeetsTarget:null,recorded:{completed:0}});
  expect(deliveryAttemptSummary(undefined,[],undefined,now).successPercent).toBeNull();
});
it('scopes the window to start time and selected repository without reconstructing legacy attempts',()=>{
  const history:DeliveryAttemptHistory={version:1,startedAt:'2026-10-12T12:00:00Z',legacyRunIds:['legacy'],attempts:[attempt('failed',1),{...attempt('successful',2),repoId:'other/repo'},{...attempt('successful',3),startedAt:'2026-08-01T12:00:00Z'},{...attempt('successful',4),startedAt:'2027-01-01T12:00:00Z'}]};
  const result=deliveryAttemptSummary(history,[{id:'legacy',repoId:'owner/repo'} as never],'owner/repo',now);expect(result.legacyRunCount).toBe(1);expect(result.recorded.completed).toBe(1);expect(result.recent).toHaveLength(1);expect(result.successPercent).toBeNull();
});
it('rejects unknown status, credential-bearing target URLs and excessive retained history',()=>{
  const history={version:1,startedAt:'2026-09-01T12:00:00Z',legacyRunIds:[],attempts:[attempt('successful',1)]};
  expect(attemptHistorySchema.safeParse({...history,attempts:[{...history.attempts[0],status:'trusted'}]}).success).toBe(false);
  expect(attemptHistorySchema.safeParse({...history,attempts:[{...history.attempts[0],environmentUrl:'https://user:credential@target.example'}]}).success).toBe(false);
  expect(attemptHistorySchema.safeParse({...history,attempts:Array(5001).fill(history.attempts[0])}).success).toBe(false);
});
