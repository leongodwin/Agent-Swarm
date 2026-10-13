import type {SynthesisJob,SynthesisSummary} from '../shared/hldSynthesis.ts';
/** Completed durations include admission, model output, validation and artifact
 * publication. Failure counts stay separate; successful samples are not an SLO. */
export function synthesisSummary(jobs:SynthesisJob[],coverageStartedAt:number,now=Date.now()):SynthesisSummary {
  const from=now-30*86400000,rows=jobs.filter(row=>row.startedAt>=from&&row.startedAt<=now),codex=rows.filter(row=>row.runtime==='codex-cli');
  const count=(status:string)=>codex.filter(row=>row.status===status).length;
  const completed=count('completed'),failed=count('failed'),blocked=count('blocked'),cancelled=count('cancelled'),terminal=completed+failed+blocked+cancelled;
  const durations=codex.filter(row=>row.status==='completed').map(row=>row.elapsedMs!).sort((a,b)=>a-b);
  const median=durations.length?(durations[Math.floor((durations.length-1)/2)]+durations[Math.floor(durations.length/2)])/2:null;
  const rate=terminal?100*completed/terminal:null,completeWindow=coverageStartedAt<=from;
  return {scope:'retained-codex-synthesis-jobs',observedAt:now,window:{from,to:now},coverageStartedAt,completeWindow,
    recorded:{completed,failed,blocked,cancelled,active:codex.length-terminal,awaitingCleanup:codex.filter(row=>row.runtimeCleanup==='awaiting-completion').length,legacyProviderJobs:rows.length-codex.length},
    successfulDurationMs:{count:durations.length,median,p95:durations.length?durations[Math.ceil(.95*durations.length)-1]:null},
    recordedCompletionPercent:rate,completeWindowCompletionPercent:completeWindow?rate:null,
    reason:(completeWindow?'Retained Codex jobs cover this start-time window.':'Complete 30-day history is unavailable; older jobs may have been pruned before collection began.')+' Durations describe successful unreviewed drafts only; blocked, failed and cancelled jobs remain in the completion denominator. This does not establish sustained latency, architecture approval, CI/integration reliability or tenant acceptance.'};
}
