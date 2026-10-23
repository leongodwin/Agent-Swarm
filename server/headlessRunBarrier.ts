import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {withHandoffMutex} from './handoffMutex.ts';
import {readBoundedText} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

/** A provider invocation is unresolved until its exact terminal run is observed.
 * Closing the client or timing out never releases this barrier. */
export async function claimHeadlessRun(root:string, scope:unknown, intent:unknown,guard:()=>Promise<void>=async()=>{}) {
  await fs.mkdir(root,{recursive:true});
  const stat=await fs.lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid headless run barrier root');
  const file=path.join(root,crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex')+'.pending.json');
  let handle;
  try { handle=await fs.open(file,'wx',0o600); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('Unresolved headless invocation blocks further runs; reconcile the original run without replay');throw error; }
  try { await handle.writeFile(JSON.stringify(intent));await handle.sync(); } finally { await handle.close(); }
  return {async started(receipt:unknown) {
    const out=await fs.open(file+'.'+crypto.randomUUID()+'.started.json','wx',0o600);
    try{await out.writeFile(JSON.stringify({scope,intent,receipt}));await out.sync();}finally{await out.close();}
  },async terminal(receipt:unknown) {
    await finalizePending(root,file,JSON.stringify(intent),scope,intent,receipt,guard);

  }};
}

const pendingFile=(root:string,scope:unknown)=>path.join(root,crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex')+'.pending.json');
async function pendingBytes(root:string,file:string){
 const directory=await fs.lstat(root),stat=await fs.lstat(file);
 if(!directory.isDirectory()||directory.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.join(await fs.realpath(root),path.basename(file)))throw Error('Headless pending storage changed');
 const raw=await readBoundedText(file,65536);if(!raw)throw Error('Headless pending intent unavailable');return raw;
}
async function finalizePending(root:string,file:string,raw:string,scope:unknown,intent:unknown,receipt:unknown,guard:()=>Promise<void>,alreadyOwned?:()=>void){
 const finish=async(assertOwned:()=>void)=>{
  await guard();assertOwned();if(await pendingBytes(root,file)!==raw)throw Error('Headless pending invocation changed');
  const archive=file+'.'+crypto.randomUUID()+'.terminal.json',out=await fs.open(archive,'wx',0o600);
  try{await out.writeFile(JSON.stringify({scope,intent,receipt}));await out.sync();}finally{await out.close();}
  await guard();assertOwned();if(await pendingBytes(root,file)!==raw)throw Error('Headless pending invocation changed before release');
  assertOwned();await fs.unlink(file);
 };
 if(alreadyOwned)return finish(alreadyOwned);
 // Original-run recovery is Windows-only. Other platforms retain the original
 // normal terminal path; they cannot invoke the new reconciliation path.
 return process.platform==='win32'?withHandoffMutex(root,finish):finish(()=>{});
}
/** Fixed Windows recovery: a trusted observer must prove the original terminal
 * run. This never triggers, retries, cancels or releases a dispatch claim. */
export async function reconcileHeadlessRunBarrier(root:string,scope:unknown,observe:(intent:unknown,started:unknown[])=>Promise<unknown>,guard:()=>Promise<void>){
 if(process.platform!=='win32')throw Error('Original-run reconciliation requires Windows kernel exclusion');
 return withHandoffMutex(root,async assertOwned=>{
  await guard();assertOwned();const file=pendingFile(root,scope),raw=await pendingBytes(root,file),intent=parseUnambiguousJson(raw,{maxBytes:65536});
  const started:unknown[]=[];let scanned=0;const directory=await fs.opendir(root);
  try{for await(const entry of directory){if(++scanned>4096)throw Error('Headless journal directory exceeds bounded recovery scan');if(!entry.name.startsWith(path.basename(file)+'.')||!entry.name.endsWith('.started.json'))continue;
   const text=await pendingBytes(root,path.join(root,entry.name)),row=parseUnambiguousJson(text,{maxBytes:65536}) as {scope?:unknown;intent?:unknown;receipt?:unknown};
   if(JSON.stringify(row.scope)===JSON.stringify(scope)&&JSON.stringify(row.intent)===raw){started.push(row.receipt);if(started.length>2)throw Error('Ambiguous native invocation journal');}
  }}finally{await directory.close().catch(()=>{});}
  const receipt=await observe(intent,started);await guard();assertOwned();
  await finalizePending(root,file,raw,scope,intent,receipt,guard,assertOwned);
  return{pendingIntentSha256:crypto.createHash('sha256').update(raw).digest('hex'),terminalReceiptSha256:crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),holdReleased:true,triggerInvoked:false,dispatchClaimPreserved:true,replayAuthorized:false};
 });
}

/** Bounds waiting only: rejection does not claim provider cancellation. */
export async function beforeHeadlessDeadline<T>(deadline:number, operation:()=>Promise<T>):Promise<T> {
  const remaining=deadline-Date.now();
  if(remaining<=0)throw Error('Headless task deadline exceeded; provider outcome may remain unknown');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Headless task deadline exceeded; provider outcome may remain unknown')),remaining);})]);}
  finally{if(timer)clearTimeout(timer);}
}
