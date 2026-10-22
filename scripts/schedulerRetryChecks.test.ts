import {expect,it} from 'vitest';
import {schedulerNativeAttemptMeasured,schedulerRetryLivePassed} from './schedulerRetryChecks.ts';
function receipt(){return {nativeOk:true,marker:'CUBEFARM_SCHEDULER_REJECT',coordinatorAttemptId:'12345678-1234-1234-1234-123456789012',agentId:'synthetic-worker',
  start:{kind:'start',runtime:'gemini',role:'dev',agentId:'synthetic-worker',coordinatorAttemptId:'12345678-1234-1234-1234-123456789012'},
  finish:{kind:'finish',outcome:'success',usageCoverage:'complete',usageScope:'attempt',usageSource:'gemini-session-v1',inputTokens:28420,outputTokens:10,costUsd:null}};}
it('accepts an owning complete native receipt while keeping USD unknown',()=>expect(schedulerNativeAttemptMeasured(receipt())).toBe(true));
it.each([
  {nativeOk:false},{marker:'wrong'},{coordinatorAttemptId:''},{agentId:'other'},
  {start:undefined},{start:{...receipt().start,runtime:'codex'}},{start:{...receipt().start,role:'qa'}},
  {start:{...receipt().start,coordinatorAttemptId:'another-attempt'}},
  {finish:undefined},{finish:{...receipt().finish,outcome:'failure'}},{finish:{...receipt().finish,usageCoverage:'partial'}},
  {finish:{...receipt().finish,usageScope:'session'}},{finish:{...receipt().finish,usageSource:'codex-response-v1'}},
  {finish:{...receipt().finish,inputTokens:null}},{finish:{...receipt().finish,outputTokens:undefined}},
  {finish:{...receipt().finish,inputTokens:Number.MAX_SAFE_INTEGER+1}},{finish:{...receipt().finish,outputTokens:0}},
  {finish:{...receipt().finish,costUsd:0}},
])('rejects incomplete, misbound or unsupported native evidence %#',patch=>expect(schedulerNativeAttemptMeasured({...receipt(),...patch})).toBe(false));

function matrix(){
  const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const agentId=id(99),ids=[1,2,3].map(id),scope=JSON.stringify({repoId:'synthetic/scheduler-retry',agentId,runtime:'gemini',role:'dev',task:'issue',issue:1,scopeHash:'a'.repeat(64),admissionHash:'b'.repeat(64)});
  const executorRows=[1,2,3].map((phase,index)=>({phase,pid:100+phase,id:ids[index],agentId}));
  const reports:Record<string,any>[]=[1,2,3,4].map((phase,index)=>{
    const count=Math.min(phase,3),launch=executorRows[index];
    return {phase,pid:100+phase,executor:'authenticated Gemini with synthetic semantic rejection',scheduler:'real Swarm.schedule',cleanup:'verified',allAutomatic:true,
      reserved:count,launched:count,reservationIds:ids.slice(0,count),finishIds:ids.slice(0,count),scopeKeys:Array(count).fill(scope),outcomes:Array(count).fill('failure'),
      retryHold:count===3?'Automatic execution budget reached for this unchanged scope/configuration':null,launches:phase<4?[launch]:[],
      nativeResults:phase<4?[{...receipt(),agentId,coordinatorAttemptId:ids[index],sessionId:id(20+phase),evidenceId:id(30+phase),nativeEvidenceError:false,measured:true,
        start:{...receipt().start,agentId,coordinatorAttemptId:ids[index],attemptId:id(30+phase)},
        finish:{...receipt().finish,agentId,coordinatorAttemptId:ids[index],attemptId:id(30+phase),runtime:'gemini',role:'dev'}}]:[]};
  });return {reports,executorRows};
}
it('accepts only the complete four-process authenticated scheduler chain',()=>{const {reports,executorRows}=matrix();expect(schedulerRetryLivePassed(reports,executorRows)).toBe(true);});
const mutations:((value:ReturnType<typeof matrix>)=>void)[]=[
  value=>value.reports.pop(),value=>value.reports.push(value.reports[3]),value=>value.executorRows.pop(),
  value=>{value.reports[1].phase=1;},value=>{value.reports[1].pid=value.reports[0].pid;},value=>{value.reports[0].pid=0;},
  value=>{value.reports[0].executor='synthetic';},value=>{value.reports[0].scheduler='direct assign';},value=>{value.reports[0].cleanup='unverified';},
  value=>{value.reports[0].allAutomatic=false;},value=>{value.reports[3].reserved=4;},value=>{value.reports[2].launched=2;},
  value=>{value.reports[3].launches=[value.executorRows[0]];},value=>{value.reports[3].nativeResults=[value.reports[0].nativeResults[0]];},
  value=>{value.reports[1].reservationIds[0]='wrong';},value=>{value.reports[3].reservationIds[2]=value.reports[3].reservationIds[1];},
  value=>{value.reports[0].scopeKeys=['changed-context'];},value=>{value.reports[3].scopeKeys=['{}','{}','{}'];},
  value=>{value.reports[1].outcomes=['failure'];},value=>{value.reports[2].outcomes[2]='interrupted';},value=>{value.reports[3].retryHold=null;},
  value=>{value.reports[0].nativeResults=[];},value=>{value.reports[0].nativeResults[0].measured=false;},
  value=>{value.reports[0].nativeResults[0].nativeEvidenceError=true;},value=>{value.reports[0].nativeResults[0].finish.inputTokens=null;},
  value=>{value.reports[0].nativeResults[0].start.coordinatorAttemptId='other';},value=>{value.reports[1].nativeResults[0].sessionId=value.reports[0].nativeResults[0].sessionId;},
  value=>{value.reports[1].nativeResults[0].evidenceId=value.reports[0].nativeResults[0].evidenceId;},
  value=>{value.executorRows[0]={...value.executorRows[0],id:'wrong'};},value=>{value.executorRows[1]={...value.executorRows[1],pid:0};},
  value=>{value.reports[0].launches=[{...value.reports[0].launches[0],agentId:'other'}];},
  value=>{value.reports[1].finishIds=['wrong','wrong'];},value=>{value.reports[0].nativeResults[0].start.attemptId='other';},
  value=>{value.reports[0].nativeResults[0].finish.coordinatorAttemptId='other';},value=>{value.reports[0].nativeResults[0].finish.agentId='other';},
];
it.each(mutations)('rejects an incomplete, replayed or mismatched scheduler chain %#',mutate=>{const value=matrix();mutate(value);expect(schedulerRetryLivePassed(value.reports,value.executorRows)).toBe(false);});
it('rejects malformed top-level reports without throwing',()=>{
  expect(schedulerRetryLivePassed([null,null,null,null],[])).toBe(false);
  expect(schedulerRetryLivePassed([{},[],{},{}],[{},{},{}])).toBe(false);
});
