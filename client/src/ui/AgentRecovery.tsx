import type {AgentRecovery as Recovery} from '../../../shared/types';

export function AgentRecovery({recovery,now=Date.now()}:{recovery:Recovery;now?:number}) {
  const at=recovery.nextAttemptAt?Date.parse(recovery.nextAttemptAt):null;
  const title=recovery.kind==='model'?'Model needs attention':at===null?'Readiness retries held':at<=now?'Readiness retry eligible':'Readiness retry scheduled';
  return <section className="term-error" aria-label="Agent recovery">
    <strong>{title}</strong>
    <p>{recovery.reason}</p>
    {recovery.kind==='model'?<p>Update the agent runtime or model, then retry the task.</p>:<>
      {at!==null&&<p>Next automatic retry eligibility: <time dateTime={recovery.nextAttemptAt!}>{new Date(at).toLocaleString()}</time>. Office drain, capacity and readiness checks still apply.</p>}
      <p>{recovery.failures} consecutive readiness failures. Repair the blocker, then retry the task to run fresh checks.{at===null?' Automatic retries remain held until configuration changes or an explicit retry succeeds.':''}</p>
    </>}
  </section>;
}
