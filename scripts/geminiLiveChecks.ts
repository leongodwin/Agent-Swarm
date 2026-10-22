export interface LiveAttempt {name?:unknown;ok?:unknown;taskAccepted?:unknown;syntheticOutput?:unknown;sessionId?:unknown;interrupted?:unknown;finish?:{usageCoverage?:unknown;inputTokens?:unknown;outputTokens?:unknown;outcome?:unknown};status?:unknown}
/** Live verification passes only when each required observed outcome is present. */
export function geminiLiveMatrixPassed(attempts:LiveAttempt[],cleanup:string){
 const last=(name:string)=>attempts.findLast(a=>a.name===name);
 const complete=(a:LiveAttempt|undefined)=>a?.ok===true&&a.finish?.usageCoverage==='complete'&&Number.isSafeInteger(a.finish.inputTokens)&&Number(a.finish.inputTokens)>=0&&Number.isSafeInteger(a.finish.outputTokens)&&Number(a.finish.outputTokens)>=0;
 const success=last('success'),failure=last('semantic-failure'),retry=last('retry'),resume=last('resume'),interrupt=last('native-escape');
 return cleanup==='verified'&&!attempts.some(a=>a.status==='blocked')&&complete(success)&&success?.taskAccepted===true&&complete(failure)&&failure?.taskAccepted===false&&failure.syntheticOutput==='CUBEFARM_EXPECTED_FAIL'&&complete(retry)&&retry?.taskAccepted===true&&complete(resume)&&resume?.taskAccepted===true&&typeof retry.sessionId==='string'&&retry.sessionId.length>0&&resume.sessionId===retry.sessionId&&interrupt?.ok===false&&interrupt.interrupted===true&&interrupt.finish?.outcome==='interrupted'&&interrupt.finish.usageCoverage!=='complete'&&interrupt.finish.inputTokens===null&&interrupt.finish.outputTokens===null;
}
