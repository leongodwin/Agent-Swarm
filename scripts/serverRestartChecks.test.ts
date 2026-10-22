import {expect,it} from 'vitest';
import {classifyRestartUserMessages,serverRestartPassed,type RestartProof} from './serverRestartChecks.ts';
const valid=():RestartProof=>({beforeExited:true,afterExited:true,keeperStopped:true,
 before:{serverPid:101,keeperPid:303,keeperInstance:'keeper-instance',nativePid:404,sessionId:'native-session',nativeResponsesBefore:0},
 after:{serverPid:202,keeperPid:303,keeperInstance:'keeper-instance',nativePids:[404],sessionId:'native-session',finalSessionId:'native-session',ok:true,cleanup:'verified',finish:{outcome:'success',runtime:'gemini',usageCoverage:'unknown',inputTokens:null,outputTokens:null,costUsd:null}},
 native:{sessionId:'native-session',projectHashMatches:true,userMessages:2,taskPrompts:1,contextMessages:1,unknownUserMessages:0,marker:'CUBEFARM_RESTART_OK'}});
it('accepts matching two-process native ownership, fresh response and deliberately unknown adoption accounting',()=>{expect(serverRestartPassed(valid())).toBe(true);});
it.each([
 ['first server still alive',(p:RestartProof)=>{p.beforeExited=false;}],
 ['second server still alive',(p:RestartProof)=>{p.afterExited=false;}],
 ['same server process',(p:RestartProof)=>{p.after!.serverPid=p.before!.serverPid;}],
 ['invalid process identity',(p:RestartProof)=>{p.before!.nativePid=0;}],
 ['unsafe process identity',(p:RestartProof)=>{p.after!.serverPid=Number.MAX_SAFE_INTEGER+1;}],
 ['replacement keeper',(p:RestartProof)=>{p.after!.keeperInstance='replacement';}],
 ['different keeper PID',(p:RestartProof)=>{p.after!.keeperPid=999;}],
 ['different native PID',(p:RestartProof)=>{p.after!.nativePids=[999];}],
 ['multiple native processes',(p:RestartProof)=>{p.after!.nativePids=[404,505];}],
 ['different resumed session',(p:RestartProof)=>{p.after!.sessionId='other';}],
 ['foreign final session',(p:RestartProof)=>{p.after!.finalSessionId='other';}],
 ['already completed before restart',(p:RestartProof)=>{p.before!.nativeResponsesBefore=1;}],
 ['foreign transcript',(p:RestartProof)=>{p.native!.sessionId='other';}],
 ['foreign project',(p:RestartProof)=>{p.native!.projectHashMatches=false;}],
 ['duplicate task prompt',(p:RestartProof)=>{p.native!.taskPrompts=2;}],
 ['extra raw user message',(p:RestartProof)=>{p.native!.userMessages=3;}],
 ['missing session context',(p:RestartProof)=>{p.native!.contextMessages=0;}],
 ['extra session context',(p:RestartProof)=>{p.native!.contextMessages=2;}],
 ['unknown user message',(p:RestartProof)=>{p.native!.unknownUserMessages=1;}],
 ['missing fresh prompt',(p:RestartProof)=>{p.native!.userMessages=0;}],
 ['wrong native output',(p:RestartProof)=>{p.native!.marker='other';}],
 ['failed task',(p:RestartProof)=>{p.after!.ok=false;}],
 ['unverified cleanup',(p:RestartProof)=>{p.after!.cleanup='requested';}],
 ['unverified keeper cleanup',(p:RestartProof)=>{p.keeperStopped=false;}],
 ['failed finish evidence',(p:RestartProof)=>{p.after!.finish!.outcome='failure';}],
 ['foreign runtime evidence',(p:RestartProof)=>{p.after!.finish!.runtime='codex';}],
 ['fabricated complete accounting',(p:RestartProof)=>{p.after!.finish!.usageCoverage='complete';}],
 ['fabricated zero input',(p:RestartProof)=>{p.after!.finish!.inputTokens=0;}],
 ['fabricated zero output',(p:RestartProof)=>{p.after!.finish!.outputTokens=0;}],
 ['fabricated zero USD',(p:RestartProof)=>{p.after!.finish!.costUsd=0;}],
] as const)('rejects %s',(_reason,mutate)=>{const proof=valid();mutate(proof);expect(serverRestartPassed(proof)).toBeFalsy();});
it.each([{}, {before:{}}, {before:valid().before}, {after:valid().after}])('rejects incomplete evidence %j',proof=>{expect(serverRestartPassed(proof)).toBeFalsy();});

const prompt='Synthetic verification only. Never read files, use tools, delegate or modify anything.\n\n\n\nReply exactly CUBEFARM_RESTART_OK. Do not use tools.';
const context='<session_context>\nThis is the Gemini CLI. We are setting up the context for our chat.\nSynthetic native context\n</session_context>';
const user=(text:string)=>({type:'user',content:[{text}]});
it('counts native session-context separately from the exact task prompt',()=>{
  expect(classifyRestartUserMessages([user(context),user(prompt),{type:'gemini',content:'response'}])).toEqual({userMessages:2,taskPrompts:1,contextMessages:1,unknownUserMessages:0});
});
it('retains duplicate task evidence rather than silently deduplicating retries',()=>{expect(classifyRestartUserMessages([user(context),user(prompt),user(prompt)])).toMatchObject({userMessages:3,taskPrompts:2,unknownUserMessages:0});});
it.each([
 {type:'user',content:prompt}, {type:'user',content:[]}, {type:'user',content:[null]},
 {type:'user',content:[{text:prompt,unexpected:true}]}, {type:'user',content:[{text:99}]},
 user(prompt+' extra'),user('<session_context>\nOther content\n</session_context>'),
 user('<session_context>\nThis is the Gemini CLI. Missing end'),user(context+' extra'),
])('holds unknown or malformed user content %j',row=>{expect(classifyRestartUserMessages([row])).toEqual({userMessages:1,taskPrompts:0,contextMessages:0,unknownUserMessages:1});});
