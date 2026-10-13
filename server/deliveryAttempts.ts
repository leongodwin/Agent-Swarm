import {z} from 'zod';
import type {DeliveryAttemptHistory,DeliveryAttemptSummary,DeliveryRun} from '../shared/delivery.ts';
const id=z.string().min(1).max(128),when=z.iso.datetime();
export const attemptHistorySchema=z.strictObject({version:z.literal(1),startedAt:when,legacyRunIds:z.array(id).max(10000),attempts:z.array(z.strictObject({id:z.uuid(),releaseId:id,repoId:z.string().min(1).max(240),head:z.string().regex(/^[a-f0-9]{40,64}$/),environmentUrl:z.url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}),runId:id.optional(),evidenceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),startedAt:when,endedAt:when.optional(),status:z.enum(['preparing','running','reviewing','successful','failed','interrupted','superseded']),reason:z.enum(['preflight','execution','cleanup','restart','superseded']).optional(),acceptanceProfile:z.enum(['production','functional-development'])})).max(5000)});
export function deliveryAttemptSummary(history:DeliveryAttemptHistory|undefined,runs:DeliveryRun[],repoId?:string,now=Date.now()):DeliveryAttemptSummary {
  const from=now-30*86400000;
  const attempts=(history?.attempts??[]).filter(row=>(!repoId||row.repoId===repoId)&&Date.parse(row.startedAt)>=from&&Date.parse(row.startedAt)<=now);
  const legacyRunCount=runs.filter(run=>(!repoId||run.repoId===repoId)&&(!history||history.legacyRunIds.includes(run.id))).length;
  const successful=attempts.filter(row=>row.status==='successful').length,unsuccessful=attempts.filter(row=>['failed','interrupted','superseded'].includes(row.status)).length;
  const completed=successful+unsuccessful,rate=completed?100*successful/completed:null;
  const completeWindow=!!history&&Date.parse(history.startedAt)<=from;
  return {scope:'retained-delivery-attempts',observedAt:new Date(now).toISOString(),window:{from:new Date(from).toISOString(),to:new Date(now).toISOString()},coverageStartedAt:history?.startedAt??null,completeWindow,legacyRunCount,recorded:{completed,successful,unsuccessful,active:attempts.filter(row=>['preparing','running'].includes(row.status)).length,awaitingReview:attempts.filter(row=>row.status==='reviewing').length,successPercent:rate},successPercent:completeWindow?rate:null,targetPercent:99.5,observedMeetsTarget:completeWindow&&rate!==null?rate>=99.5:null,
    reason:completeWindow?'Recorded delivery attempts cover this window. CI providers, health checks and other integration systems remain separate; this metric is not production acceptance.':'Complete 30-day delivery history is unavailable. Recorded subset counts cannot establish the overall clean-run target; legacy attempts are not reconstructed.',recent:[...attempts].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,20)};
}
