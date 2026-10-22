import path from 'node:path';
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const required=['scripts/office.mjs','scripts/officeSteps.mjs','scripts/officeRecovery.mjs','server/policyReaderHost.mjs','server/officeReload.mjs','bin/cubefarm.js','package.json','dist-server/index.js','dist-server/ptyHost.js'];
/** Approval needs physical ownership, durable identity, one native task and conservative accounting together. */
export function fullLauncherPassed(proof:Record<string,any>,error?:unknown):boolean{
 try{
  if(error!==undefined&&error!==null||!proof||!positive(proof.launcherPid)||typeof proof.root!=='string'||typeof proof.home!=='string'||proof.home!==path.join(proof.root,'home'))return false;
  if(!Array.isArray(proof.productionBytes)||proof.productionBytes.length!==required.length||new Set(proof.productionBytes.map((row:any)=>row.entry)).size!==required.length||required.some(entry=>!proof.productionBytes.some((row:any)=>row.entry===entry&&sha(row.sourceSha256)&&row.sourceSha256===row.copiedSha256)))return false;
  const runtimes=[proof.boot,proof.reloaded,proof.beforeCrash,proof.afterCrash];
  if(runtimes.some(row=>!row||!positive(row.pid)||row.pid===proof.launcherPid||row.parentPid!==proof.launcherPid||row.demo!==false||row.homeDir!==proof.home||row.reload?.supported!==true))return false;
  const [boot,reloaded,before,after]=runtimes;
  if(new Set([boot.pid,reloaded.pid,after.pid]).size!==3||before.pid!==reloaded.pid||reloaded.draining!==true||reloaded.reload.phase!=='ready'||typeof proof.reloadAccepted?.operationId!=='string'||!proof.reloadAccepted.operationId||reloaded.reload.operationId!==proof.reloadAccepted.operationId||reloaded.reload.sourcePid!==boot.pid||reloaded.reload.targetPid!==reloaded.pid)return false;
  if(!['taskkill-server-only','SIGKILL-server'].includes(proof.forcedExit?.method)||proof.forcedExit.targetPid!==before.pid)return false;
  const a=before.nativeRuntime,b=after.nativeRuntime;
  if(!a||!b||!positive(a.keeperPid)||a.keeperPid!==b.keeperPid||typeof a.keeperInstance!=='string'||!a.keeperInstance||a.keeperInstance!==b.keeperInstance||!Array.isArray(a.nativePids)||a.nativePids.length!==1||!positive(a.nativePids[0])||!Array.isArray(b.nativePids)||b.nativePids.length!==1||a.nativePids[0]!==b.nativePids[0]||new Set([proof.launcherPid,before.pid,after.pid,a.keeperPid,a.nativePids[0]]).size!==5)return false;
  if(proof.busy?.status!=='working'||proof.busy.sessionCli!=='gemini'||proof.busy.jobKind!=='chat'||typeof proof.busy.sessionId!=='string'||!proof.busy.sessionId||!sha(proof.busy.nativeSha256)||proof.done?.status!=='done'||proof.done.job!==null||proof.done.sessionId!==proof.busy.sessionId)return false;
  if(proof.native?.sessionId!==proof.busy.sessionId||!sha(proof.native.sha256)||proof.native.projectHashMatches!==true||proof.native.exactMarker!==true||proof.native.responseCount!==1||proof.native.taskPrompts!==1||proof.native.userMessages!==2||proof.native.contextMessages!==1||proof.native.unknownUserMessages!==0)return false;
  if(!Array.isArray(proof.attempts)||proof.attempts.length!==2||new Set(proof.attempts.map((row:any)=>row.id)).size!==2)return false;
  const original=proof.attempts.find((row:any)=>row.first?.resumed===false),adopted=proof.attempts.find((row:any)=>row.first?.resumed===true),start=adopted?.first,finish=adopted?.finish;
  if(original?.first?.agentId!=='ceo'||original.first.runtime!=='gemini'||original.first.role!=='ceo'||original.first.resumed!==false||original.first.kind!=='start'||original.first.attemptId!==original.id||original.finish?.kind==='finish')return false;
  if(start?.kind!=='start'||finish?.kind!=='finish'||start.attemptId!==adopted.id||finish.attemptId!==adopted.id||!sha(start.taskSha256)||start.taskSha256!==original.first.taskSha256||finish.taskSha256!==start.taskSha256)return false;
  if([start,finish].some(row=>row.agentId!=='ceo'||row.runtime!=='gemini'||row.role!=='ceo'||row.resumed!==true)||finish.outcome!=='success'||finish.usageCoverage!=='unknown'||finish.usageSource!=='gemini-session-v1'||finish.usageScope!=='attempt'||finish.inputTokens!==null||finish.outputTokens!==null||finish.costUsd!==null)return false;
  return proof.cleanup==='verified'&&proof.launcherExited===true;
 }catch{return false;}
}

/** The genuine updater must build the local fast-forward, then roll back a failed build and serve the last good head. */
export function launcherUpdatePassed(chain:Record<string,any>,launcherPid:number,home:string,expectedNativeCount:0|1=1):boolean{
 try{
  if(expectedNativeCount!==0&&expectedNativeCount!==1)return false;
  const commit=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
  if(!chain||chain.localOnly!==true||chain.originPath!==path.join(path.dirname(home),'origin.git')||!positive(launcherPid))return false;
  const good=chain.success,bad=chain.rollback;
  if(!good||!bad||![good.from,good.to,bad.failedTarget].every(commit)||new Set([good.from,good.to,bad.failedTarget]).size!==3||bad.from!==good.to)return false;
  const runtimes=[good.before,good.after,bad.before,bad.after];
  if(runtimes.some(row=>!row||!positive(row.pid)||row.parentPid!==launcherPid||row.demo!==false||row.homeDir!==home||row.reload?.supported!==true||row.draining!==true))return false;
  if(good.after.pid!==bad.before.pid||new Set([good.before.pid,good.after.pid,bad.after.pid]).size!==3||runtimes.some(row=>row.pid===launcherPid))return false;
  const native=good.before.nativeRuntime;
  if(!native||!positive(native.keeperPid)||typeof native.keeperInstance!=='string'||!native.keeperInstance||!Array.isArray(native.nativePids)||native.nativePids.length!==expectedNativeCount||expectedNativeCount===1&&!positive(native.nativePids[0]))return false;
  if(runtimes.some(row=>row.nativeRuntime?.keeperPid!==native.keeperPid||row.nativeRuntime?.keeperInstance!==native.keeperInstance||!Array.isArray(row.nativeRuntime?.nativePids)||row.nativeRuntime.nativePids.length!==expectedNativeCount||row.nativeRuntime.nativePids[0]!==native.nativePids[0]))return false;
  if(new Set([launcherPid,good.before.pid,good.after.pid,bad.after.pid,native.keeperPid,...native.nativePids]).size!==5+expectedNativeCount)return false;
  if(good.head!==good.to||good.update?.ok!==true||good.update.from!==good.from||good.update.to!==good.to||good.update.built!==true||good.update.installed!==false)return false;
  if(bad.head!==good.to||bad.update?.ok!==false||bad.update.from!==good.to||bad.update.to!==good.to||bad.update.built!==true||bad.update.installed!==false||typeof bad.update.error!=='string'||!bad.update.error.trim()||bad.rollbackObserved!==true)return false;
  return true;
 }catch{return false;}
}
