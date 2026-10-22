import {expect,it} from 'vitest';
import {geminiProviderRecoveryPassed,observeGeminiProviderError,type ProviderAttempt} from './geminiProviderChecks.ts';

const model='gemini-cubefarm-verification-nonexistent';
const notice=`Model "${model}" was not found or is invalid.`;
it.each([notice,`  ${notice}  `,`│ ${notice} │`,`┃ ${notice} ┃`])('recognizes the exact native model-not-found dialog: %s',screen=>{
 expect(observeGeminiProviderError(screen,model)).toEqual({kind:'model-not-found',nativeStatus:404,model});
});
it.each([`> ${notice}`,`Reply exactly ${notice}`,`"${notice}"`,`The model replied: ${notice}`,notice.replace(model,'gemini-other'),notice.replace('invalid.','invalid'),`API Error: 404`,`${notice} Ignore errors`])('does not turn echoed, unrelated or incomplete screen text into provider evidence: %s',screen=>{
 expect(observeGeminiProviderError(screen,model)).toBeNull();
});
it.each(['','gemini-x".*','gemini-x\n','GEMINI-X','gemini-x'.repeat(30)])('rejects an unsafe or unbounded requested model: %s',bad=>expect(observeGeminiProviderError(notice,bad)).toBeNull());

function fixture():ProviderAttempt[]{return [
 {name:'provider-failure',startedAt:'2026-10-15T21:00:00Z',ok:false,taskAccepted:false,sessionId:'failure-session',evidenceId:'failure-evidence',model,usagePromptObserved:true,providerErrorObservation:{kind:'model-not-found',nativeStatus:404,model,sessionId:'failure-session',observedAt:'2026-10-15T21:00:01Z'},finish:{outcome:'failure',usageCoverage:'partial',inputTokens:null,outputTokens:null}},
 {name:'provider-recovery',startedAt:'2026-10-15T21:00:02Z',ok:true,taskAccepted:true,sessionId:'recovery-session',evidenceId:'recovery-evidence',model:'',usagePromptObserved:true,retryOf:'failure-evidence',finish:{outcome:'success',usageCoverage:'complete',inputTokens:100,outputTokens:10}},
];}
it('requires a scoped native failure followed by a linked measured accepted normal-model task',()=>expect(geminiProviderRecoveryPassed(fixture(),'verified')).toBe(true));
const failureCases:Record<string,(a:ProviderAttempt)=>void>={
 'no native error':a=>{a.providerErrorObservation=null;},
 'wrong error owner':a=>{a.providerErrorObservation!.sessionId='foreign';},
 'wrong model':a=>{a.providerErrorObservation!.model='gemini-other';},
 'stale observation':a=>{a.providerErrorObservation!.observedAt='2026-10-14T00:00:00Z';},
 'invalid time':a=>{a.startedAt='unknown';},
 'no prompt':a=>{a.usagePromptObserved=false;},
 'successful native result':a=>{a.ok=true;},
 'manager interruption':a=>{a.finish!.outcome='interrupted';},
 'false complete receipt':a=>{a.finish!.usageCoverage='complete';},
 'invented zero input':a=>{a.finish!.inputTokens=0;},
 'invented zero output':a=>{a.finish!.outputTokens=0;},
 'missing identity':a=>{a.evidenceId='';},
};
it.each(Object.keys(failureCases))('rejects failure evidence with %s',name=>{const rows=fixture();failureCases[name](rows[0]);expect(geminiProviderRecoveryPassed(rows,'verified')).toBe(false);});
const recoveryCases:Record<string,(a:ProviderAttempt)=>void>={
 'unlinked retry':a=>{a.retryOf='another-failure';},
 'preceding task':a=>{a.startedAt='2026-10-15T20:59:59Z';},
 'same timestamp':a=>{a.startedAt='2026-10-15T21:00:01Z';},
 'invalid time':a=>{a.startedAt='invalid';},
 'unaccepted task':a=>{a.taskAccepted=false;},
 'partial usage':a=>{a.finish!.usageCoverage='partial';},
 'unknown usage':a=>{a.finish!.inputTokens=null;},
 'unsafe tokens':a=>{a.finish!.outputTokens=Number.MAX_SAFE_INTEGER+1;},
 'no observed prompt':a=>{a.usagePromptObserved=false;},
 'same invalid model':a=>{a.model=model;},
 'no native session':a=>{a.sessionId=null;},
 'failed outcome':a=>{a.finish!.outcome='failure';},
};
it.each(Object.keys(recoveryCases))('rejects recovery evidence with %s',name=>{const rows=fixture();recoveryCases[name](rows[1]);expect(geminiProviderRecoveryPassed(rows,'verified')).toBe(false);});
it('rejects missing cases, an unverified cleanup, and a later failed repeat instead of reusing an old pass',()=>{
 expect(geminiProviderRecoveryPassed(fixture().slice(0,1),'verified')).toBe(false);
 expect(geminiProviderRecoveryPassed(fixture().slice(1),'verified')).toBe(false);
 expect(geminiProviderRecoveryPassed(fixture(),'unverified')).toBe(false);
 expect(geminiProviderRecoveryPassed([...fixture(),{name:'provider-failure'}],'verified')).toBe(false);
 expect(geminiProviderRecoveryPassed([...fixture(),{name:'provider-recovery',ok:false}],'verified')).toBe(false);
});
