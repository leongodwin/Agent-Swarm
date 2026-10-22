/** Acceptance of native work is independent of the intentionally rejected scheduler task. */
export function schedulerNativeAttemptMeasured(value:{nativeOk:unknown;marker:unknown;coordinatorAttemptId:unknown;agentId:unknown;start?:Record<string,unknown>;finish?:Record<string,unknown>}){
  const {start,finish}=value;
  return value.nativeOk===true&&value.marker==='CUBEFARM_SCHEDULER_REJECT'&&typeof value.coordinatorAttemptId==='string'&&value.coordinatorAttemptId.length===36&&
    typeof value.agentId==='string'&&value.agentId.length>0&&start?.kind==='start'&&start.runtime==='gemini'&&start.role==='dev'&&start.agentId===value.agentId&&start.coordinatorAttemptId===value.coordinatorAttemptId&&
    finish?.kind==='finish'&&finish.outcome==='success'&&finish.usageCoverage==='complete'&&finish.usageScope==='attempt'&&finish.usageSource==='gemini-session-v1'&&
    Number.isSafeInteger(finish.inputTokens)&&Number(finish.inputTokens)>0&&Number.isSafeInteger(finish.outputTokens)&&Number(finish.outputTokens)>0&&finish.costUsd===null;
}

const object=(value:unknown):Record<string,any>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:null;
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** Fail closed across the complete fresh-process chain, not merely the final ledger report. */
export function schedulerRetryLivePassed(reports:unknown[],executorRows:unknown[]):boolean{
  try{
    if(!Array.isArray(reports)||reports.length!==4||!Array.isArray(executorRows)||executorRows.length!==3)return false;
    const checked=reports.map(object);if(checked.some(row=>!row))return false;
    const phases=checked as Record<string,any>[],last=phases[3];
    if(!Array.isArray(last.reservationIds)||last.reservationIds.length!==3||!last.reservationIds.every(uuid)||new Set(last.reservationIds).size!==3)return false;
    if(!Array.isArray(last.scopeKeys)||last.scopeKeys.length!==3||new Set(last.scopeKeys).size!==1||typeof last.scopeKeys[0]!=='string')return false;
    const context=object(JSON.parse(last.scopeKeys[0]));
    if(!context||context.repoId!=='synthetic/scheduler-retry'||context.runtime!=='gemini'||context.role!=='dev'||context.task!=='issue'||context.issue!==1||!uuid(context.agentId)||
      !/^[a-f0-9]{64}$/.test(context.scopeHash)||!/^[a-f0-9]{64}$/.test(context.admissionHash))return false;
    const pids=new Set<number>(),sessions=new Set<string>(),evidenceIds=new Set<string>();
    for(let index=0;index<4;index++){
      const row=phases[index],count=Math.min(index+1,3),launchCount=index<3?1:0;
      if(row.phase!==index+1||!Number.isSafeInteger(row.pid)||row.pid<=0||pids.has(row.pid)||row.executor!=='authenticated Gemini with synthetic semantic rejection'||
        row.scheduler!=='real Swarm.schedule'||row.cleanup!=='verified'||row.allAutomatic!==true||row.reserved!==count||row.launched!==count||
        !Array.isArray(row.launches)||row.launches.length!==launchCount||!Array.isArray(row.nativeResults)||row.nativeResults.length!==launchCount||
        !Array.isArray(row.reservationIds)||JSON.stringify(row.reservationIds)!==JSON.stringify(last.reservationIds.slice(0,count))||
        !Array.isArray(row.scopeKeys)||row.scopeKeys.length!==count||!row.scopeKeys.every((key:unknown)=>key===last.scopeKeys[0])||
        !Array.isArray(row.finishIds)||JSON.stringify(row.finishIds)!==JSON.stringify(row.reservationIds)||
        !Array.isArray(row.outcomes)||row.outcomes.length!==count||!row.outcomes.every((outcome:unknown)=>outcome==='failure'))return false;
      pids.add(row.pid);
      if(index===3){if(typeof row.retryHold!=='string'||!row.retryHold.startsWith('Automatic execution budget reached'))return false;continue;}
      const launch=object(row.launches[0]),external=object(executorRows[index]),native=object(row.nativeResults[0]);
      if(!launch||!external||!native||launch.id!==last.reservationIds[index]||launch.agentId!==context.agentId||launch.pid!==row.pid||launch.phase!==index+1||
        external.id!==launch.id||external.agentId!==launch.agentId||external.pid!==launch.pid||external.phase!==launch.phase||
        native.coordinatorAttemptId!==launch.id||native.agentId!==context.agentId||native.measured!==true||native.nativeEvidenceError!==false||
        !uuid(native.sessionId)||sessions.has(native.sessionId)||!uuid(native.evidenceId)||evidenceIds.has(native.evidenceId)||
        native.start?.attemptId!==native.evidenceId||native.finish?.attemptId!==native.evidenceId||native.finish?.agentId!==context.agentId||
        native.finish?.coordinatorAttemptId!==launch.id||native.finish?.runtime!=='gemini'||native.finish?.role!=='dev'||
        !schedulerNativeAttemptMeasured({nativeOk:native.nativeOk,marker:native.marker,coordinatorAttemptId:native.coordinatorAttemptId,agentId:native.agentId,start:object(native.start)??undefined,finish:object(native.finish)??undefined}))return false;
      sessions.add(native.sessionId);evidenceIds.add(native.evidenceId);
    }
    return true;
  }catch{return false;}
}
