import type {ProviderAttempt} from './geminiProviderChecks.ts';
export interface RetainedAttempt extends ProviderAttempt {coordinatorAttemptId?:string;retainedRuntimePids?:number[];coldPromptBeforeAttach?:boolean;coldPromptAt?:string;coldAttachedAt?:string}
export interface RetainedGapEvidence {fourthDenied?:boolean;eventsUnchanged?:boolean;freshProcess?:{denied?:boolean;events?:number};ledgerRows?:{kind:string;id?:string;sessionEvidenceId?:string;outcome?:string;automatic?:boolean}[];report?:{availability?:string;counts?:{reserved?:number;launched?:number;reportedSuccess?:number;incomplete?:number};usage?:{measuredAttempts?:number;unknownAttempts?:number};retryHolds?:{attempts:number}[]}}
/** Ownerless in-flight adoption is checked separately from a true server-process restart. */
export function geminiRetainedGapsPassed(attempts:RetainedAttempt[],evidence:RetainedGapEvidence|undefined,cleanup:string){
 const seed=attempts.findLast(a=>a.name==='retained-seed'),next=attempts.findLast(a=>a.name==='retained-followup'),cold=attempts.findLast(a=>a.name==='cold-adoption');
 const successful=(a:RetainedAttempt|undefined)=>a?.ok===true&&a.taskAccepted===true&&a.usagePromptObserved===true&&a.finish?.outcome==='success';
 const measured=(a:RetainedAttempt|undefined)=>successful(a)&&a!.finish!.usageCoverage==='complete'&&Number.isSafeInteger(a!.finish!.inputTokens)&&Number(a!.finish!.inputTokens)>0&&Number.isSafeInteger(a!.finish!.outputTokens)&&Number(a!.finish!.outputTokens)>0;
 if(cleanup!=='verified'||!measured(seed)||!measured(next)||!successful(cold)||!seed?.sessionId||next?.sessionId!==seed.sessionId||cold?.sessionId!==seed.sessionId)return false;
 const pids=seed.retainedRuntimePids;
 if(!pids?.length||pids.some(n=>!Number.isSafeInteger(n)||n<=0)||new Set(pids).size!==pids.length||[next,cold].some(a=>!a?.retainedRuntimePids||JSON.stringify([...a.retainedRuntimePids].sort((a,b)=>a-b))!==JSON.stringify([...pids].sort((a,b)=>a-b))))return false;
 if(cold.coldPromptBeforeAttach!==true||!Number.isFinite(Date.parse(cold.coldPromptAt??''))||!(Date.parse(cold.coldPromptAt!)>=Date.parse(cold.startedAt??''))||!(Date.parse(cold.coldAttachedAt??'')>=Date.parse(cold.coldPromptAt!))||cold.finish?.usageCoverage==='complete'||cold.finish?.inputTokens!==null||cold.finish?.outputTokens!==null)return false;
 const rows=evidence?.ledgerRows;
 if(!rows||rows.length!==10||rows[0]?.kind!=='collection'||rows.filter(r=>r.kind==='reserve').length!==3||rows.filter(r=>r.kind==='launch').length!==3||rows.filter(r=>r.kind==='finish').length!==3)return false;
 const ids=[seed,next,cold].map(a=>a?.coordinatorAttemptId),receipts=[seed,next,cold].map(a=>a?.evidenceId);
 if(ids.some(id=>!id)||new Set(ids).size!==3||receipts.some(id=>!id)||new Set(receipts).size!==3)return false;
 for(const [index,id] of ids.entries()){
  const reserve=rows.findIndex(r=>r.kind==='reserve'&&r.id===id),launch=rows.findIndex(r=>r.kind==='launch'&&r.id===id),finish=rows.findIndex(r=>r.kind==='finish'&&r.id===id&&r.sessionEvidenceId===receipts[index]&&r.outcome==='reported-success');
  if(reserve<1||launch<=reserve||finish<=launch||rows[reserve].automatic!==true)return false;
 }
 const report=evidence?.report;
 return evidence?.fourthDenied===true&&evidence.eventsUnchanged===true&&evidence.freshProcess?.denied===true&&evidence.freshProcess.events===rows.length&&report?.availability==='ready'&&report.counts?.reserved===3&&report.counts.launched===3&&report.counts.reportedSuccess===3&&report.counts.incomplete===0&&report.usage?.measuredAttempts===2&&report.usage.unknownAttempts===1&&report.retryHolds?.length===1&&report.retryHolds[0].attempts===3;
}
