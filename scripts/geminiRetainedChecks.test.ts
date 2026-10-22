import {expect,it} from 'vitest';
import {geminiRetainedGapsPassed,type RetainedAttempt,type RetainedGapEvidence} from './geminiRetainedChecks.ts';
function fixture(){const attempts:RetainedAttempt[]=['retained-seed','retained-followup','cold-adoption'].map((name,i)=>({name,sessionId:'native-session',coordinatorAttemptId:`attempt-${i}`,evidenceId:`receipt-${i}`,ok:true,taskAccepted:true,usagePromptObserved:true,retainedRuntimePids:[100,101],startedAt:'2026-10-15T20:00:00Z',finish:{outcome:'success',usageCoverage:i===2?'unknown':'complete',inputTokens:i===2?null:100,outputTokens:i===2?null:10},...(i===2?{coldPromptBeforeAttach:true,coldPromptAt:'2026-10-15T20:00:01Z',coldAttachedAt:'2026-10-15T20:00:02Z'}:{})}));
 const ledgerRows:NonNullable<RetainedGapEvidence['ledgerRows']>=[{kind:'collection'}];for(const a of attempts)ledgerRows.push({kind:'reserve',id:a.coordinatorAttemptId,automatic:true},{kind:'launch',id:a.coordinatorAttemptId},{kind:'finish',id:a.coordinatorAttemptId,outcome:'reported-success',sessionEvidenceId:a.evidenceId});
 const evidence:RetainedGapEvidence={fourthDenied:true,eventsUnchanged:true,freshProcess:{denied:true,events:10},ledgerRows,report:{availability:'ready',counts:{reserved:3,launched:3,reportedSuccess:3,incomplete:0},usage:{measuredAttempts:2,unknownAttempts:1},retryHolds:[{attempts:3}]}};return {attempts,evidence};}
it('accepts measured same-runtime followup, explicitly unknown ownerless adoption, and durable fourth-attempt hold',()=>{const f=fixture();expect(geminiRetainedGapsPassed(f.attempts,f.evidence,'verified')).toBe(true);});
const mutations:Record<string,(f:ReturnType<typeof fixture>)=>void>={
 'changed session':f=>{f.attempts[1].sessionId='foreign';},
 'replaced process':f=>{f.attempts[2].retainedRuntimePids=[999];},
 'no process proof':f=>{f.attempts[0].retainedRuntimePids=[];},
 'duplicate process':f=>{f.attempts[0].retainedRuntimePids=[100,100];},
 'unaccepted seed':f=>{f.attempts[0].taskAccepted=false;},
 'partial followup':f=>{f.attempts[1].finish!.usageCoverage='partial';},
 'unsafe counts':f=>{f.attempts[0].finish!.inputTokens=Number.MAX_SAFE_INTEGER+1;},
 'no prompt':f=>{f.attempts[2].usagePromptObserved=false;},
 'fallback adoption':f=>{f.attempts[2].coldPromptBeforeAttach=false;},
 'adopted before prompt':f=>{f.attempts[2].coldAttachedAt='2026-10-15T19:59:59Z';},
 'historical prompt':f=>{f.attempts[2].coldPromptAt='2026-10-14T20:00:00Z';},
 'invented cold tokens':f=>{f.attempts[2].finish!.inputTokens=0;},
 'invented complete adoption':f=>{f.attempts[2].finish!.usageCoverage='complete';},
 'same receipt':f=>{f.attempts[2].evidenceId=f.attempts[0].evidenceId;},
 'same coordinator attempt':f=>{f.attempts[2].coordinatorAttemptId=f.attempts[0].coordinatorAttemptId;},
 'missing launch':f=>{f.evidence.ledgerRows!.splice(2,1);},
 'wrong receipt binding':f=>{f.evidence.ledgerRows![9].sessionEvidenceId='foreign';},
 'extra fourth reserve':f=>{f.evidence.ledgerRows!.push({kind:'reserve',id:'fourth'});},
 'manual instead of automatic':f=>{f.evidence.ledgerRows![1].automatic=false;},
 'fourth allowed':f=>{f.evidence.fourthDenied=false;},
 'ledger changed by denial':f=>{f.evidence.eventsUnchanged=false;},
 'restart allowed':f=>{f.evidence.freshProcess!.denied=false;},
 'different reopened events':f=>{f.evidence.freshProcess!.events=9;},
 'unavailable report':f=>{f.evidence.report!.availability='unavailable';},
 'cold billed as measured':f=>{f.evidence.report!.usage!.measuredAttempts=3;},
 'missing retry hold':f=>{f.evidence.report!.retryHolds=[];},
};
it.each(Object.keys(mutations))('rejects %s evidence',name=>{const f=fixture();mutations[name](f);expect(geminiRetainedGapsPassed(f.attempts,f.evidence,'verified')).toBe(false);});
it('rejects missing cases, missing ledger and unverified native cleanup',()=>{const f=fixture();for(let i=0;i<3;i++)expect(geminiRetainedGapsPassed(f.attempts.filter((_,n)=>n!==i),f.evidence,'verified')).toBe(false);expect(geminiRetainedGapsPassed(f.attempts,undefined,'verified')).toBe(false);expect(geminiRetainedGapsPassed(f.attempts,f.evidence,'unverified')).toBe(false);});
