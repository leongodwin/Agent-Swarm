export interface ProviderObservation {kind:'model-not-found';nativeStatus:404;model:string}
/** Native 404 classification constructs ModelNotFoundError, which emits this dialog for unknown models. */
export function observeGeminiProviderError(screen:string,model:string):ProviderObservation|null {
 if(!/^gemini-[a-z0-9-]{1,100}$/.test(model))return null;
 const expected=`Model "${model}" was not found or is invalid.`;
 return screen.split('\n').some(line=>line.replace(/^[\s│┃]*|[\s│┃]*$/g,'')===expected)?{kind:'model-not-found',nativeStatus:404,model}:null;
}
export interface ProviderAttempt {
 name?:string;startedAt?:string;ok?:boolean;taskAccepted?:boolean;sessionId?:string|null;evidenceId?:string;retryOf?:string|null;model?:string;usagePromptObserved?:boolean;
 providerErrorObservation?:(ProviderObservation&{sessionId:string;observedAt:string})|null;
 finish?:{outcome?:string;usageCoverage?:string;inputTokens?:number|null;outputTokens?:number|null};
}
export function geminiProviderRecoveryPassed(attempts:ProviderAttempt[],cleanup:string){
 const failure=attempts.findLast(a=>a.name==='provider-failure'),recovery=attempts.findLast(a=>a.name==='provider-recovery'),error=failure?.providerErrorObservation;
 const time=(value:string|undefined)=>value?Date.parse(value):NaN;
 return cleanup==='verified'&&!!failure?.evidenceId&&!!failure.sessionId&&failure.usagePromptObserved===true&&failure.ok===false&&failure.taskAccepted===false&&failure.finish?.outcome==='failure'&&failure.finish.usageCoverage!=='complete'&&failure.finish.inputTokens===null&&failure.finish.outputTokens===null&&error?.kind==='model-not-found'&&error.nativeStatus===404&&error.model===failure.model&&error.sessionId===failure.sessionId&&time(error.observedAt)>=time(failure.startedAt)&&!!recovery?.sessionId&&recovery.retryOf===failure.evidenceId&&time(recovery.startedAt)>time(error.observedAt)&&recovery.ok===true&&recovery.taskAccepted===true&&recovery.model===''&&recovery.usagePromptObserved===true&&recovery.finish?.outcome==='success'&&recovery.finish.usageCoverage==='complete'&&Number.isSafeInteger(recovery.finish.inputTokens)&&Number(recovery.finish.inputTokens)>0&&Number.isSafeInteger(recovery.finish.outputTokens)&&Number(recovery.finish.outputTokens)>0;
}
