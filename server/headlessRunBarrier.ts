import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** A provider invocation is unresolved until its exact terminal run is observed.
 * Closing the client or timing out never releases this barrier. */
export async function claimHeadlessRun(root:string, scope:unknown, intent:unknown) {
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
    const archive=file+'.'+crypto.randomUUID()+'.terminal.json';
    const out=await fs.open(archive,'wx',0o600);
    try {await out.writeFile(JSON.stringify({scope,intent,receipt}));await out.sync();}finally{await out.close();}
    await fs.unlink(file);
  }};
}

/** Bounds waiting only: rejection does not claim provider cancellation. */
export async function beforeHeadlessDeadline<T>(deadline:number, operation:()=>Promise<T>):Promise<T> {
  const remaining=deadline-Date.now();
  if(remaining<=0)throw Error('Headless task deadline exceeded; provider outcome may remain unknown');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Headless task deadline exceeded; provider outcome may remain unknown')),remaining);})]);}
  finally{if(timer)clearTimeout(timer);}
}
