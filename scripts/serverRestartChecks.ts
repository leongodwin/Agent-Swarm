export interface RestartProof {
 before?:{serverPid?:number;keeperPid?:number;keeperInstance?:string;nativePid?:number;sessionId?:string;nativeResponsesBefore?:number};
 after?:{serverPid?:number;keeperPid?:number;keeperInstance?:string;nativePids?:number[];sessionId?:string;finalSessionId?:string;ok?:boolean;cleanup?:string;finish?:{outcome?:string;runtime?:string;usageCoverage?:string;inputTokens?:number|null;outputTokens?:number|null;costUsd?:number|null}};
 beforeExited?:boolean;afterExited?:boolean;native?:{sessionId?:string;projectHashMatches?:boolean;userMessages?:number;taskPrompts?:number;contextMessages?:number;unknownUserMessages?:number;marker?:string};keeperStopped?:boolean;
}
/** Real process exit and native ownership must agree; a successful callback alone cannot approve adoption. */
export function serverRestartPassed(proof:RestartProof){
 const a=proof.before,b=proof.after;const pid=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
 return proof.beforeExited===true&&proof.afterExited===true&&pid(a?.serverPid)&&pid(b?.serverPid)&&a!.serverPid!==b!.serverPid&&pid(a!.keeperPid)&&a!.keeperPid===b!.keeperPid&&!!a!.keeperInstance&&a!.keeperInstance===b!.keeperInstance&&pid(a!.nativePid)&&b!.nativePids?.length===1&&b!.nativePids[0]===a!.nativePid&&!!a!.sessionId&&a!.sessionId===b!.sessionId&&b!.sessionId===b!.finalSessionId&&a!.nativeResponsesBefore===0&&proof.native?.sessionId===a!.sessionId&&proof.native.projectHashMatches===true&&proof.native.userMessages===2&&proof.native.taskPrompts===1&&proof.native.contextMessages===1&&proof.native.unknownUserMessages===0&&proof.native.marker==='CUBEFARM_RESTART_OK'&&b!.ok===true&&b!.cleanup==='verified'&&b!.finish?.outcome==='success'&&b!.finish.runtime==='gemini'&&b!.finish.usageCoverage==='unknown'&&b!.finish.inputTokens===null&&b!.finish.outputTokens===null&&b!.finish.costUsd===null&&proof.keeperStopped===true;
}

/** Native 0.64 records its initial session context as a user row before the actual task prompt. */
export function classifyRestartUserMessages(rows:Record<string,unknown>[]){
 const prompt='Synthetic verification only. Never read files, use tools, delegate or modify anything.\n\n\n\nReply exactly CUBEFARM_RESTART_OK. Do not use tools.';
 let userMessages=0,taskPrompts=0,contextMessages=0,unknownUserMessages=0;
 for(const row of rows){if(row.type!=='user')continue;userMessages++;
  const content=row.content;const parts=Array.isArray(content)?content:[];
  if(!parts.length||parts.some(part=>!part||typeof part!=='object'||Object.keys(part).length!==1||typeof part.text!=='string')){unknownUserMessages++;continue;}
  const text=parts.map(part=>part.text).join('');
  if(text===prompt)taskPrompts++;else if(text.startsWith('<session_context>\nThis is the Gemini CLI.')&&text.trimEnd().endsWith('</session_context>'))contextMessages++;else unknownUserMessages++;
 }
 return {userMessages,taskPrompts,contextMessages,unknownUserMessages};
}
