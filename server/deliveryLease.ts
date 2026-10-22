import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedJson} from './boundedJson.ts';
import {initializeNativeEpoch} from './nativeCommandJournal.ts';
import {HttpError} from './httpError.ts';

const base={pid:z.number().int().positive().max(2147483647),token:z.uuid()};
const schema=z.union([z.object({...base,schemaVersion:z.literal(1),acquiredAt:z.iso.datetime()}).strict(),z.object(base).strict()]);
export interface DeliveryLease { readonly identitySha256:string; assertOwned():Promise<void>; release():Promise<void> }

/** The legacy filename remains exclusive with older offices. A dead PID is not
 * proof that a dispatched platform mutation stopped, so never reclaim automatically. */
export async function acquireDeliveryLease(root:string):Promise<DeliveryLease> {
  const file=path.join(root,'delivery.lock'),guard=`${file}.reaping`;
  const record={schemaVersion:1 as const,pid:process.pid,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()};
  const read=async()=>{
    try {
      const raw=await readBoundedJson(file,16*1024);
      const result=schema.safeParse(raw);
      if(result.success)return result.data;
    } catch {/* Never expose raw lease contents or treat an unreadable owner as dead. */}
    throw new HttpError(409,'Delivery lease is missing or invalid; inspect ownership before recovery');
  };
  await fs.mkdir(guard).catch(()=>{throw new HttpError(409,'Delivery ownership recovery or release is already in progress');});
  try {
  if(await fs.lstat(path.join(root,'delivery-handoff.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw new HttpError(409,'Incomplete delivery handoff requires explicit reconciliation');
  try {
    const handle=await fs.open(file,'wx');
    try {await handle.writeFile(JSON.stringify(record));}finally{await handle.close();}
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const previous=await read();
    let dead=false;
    try{process.kill(previous.pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}
    throw new HttpError(409,dead?'Interrupted delivery lease; reconcile outstanding platform operations before clearing it':'Another delivery process owns the deployment lease; PID reuse or unavailable process inspection cannot authorize takeover');
  }
  await initializeNativeEpoch(root,crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex'));
  let released=false,releaseWork:Promise<void>|undefined;
  const assertOwned=async()=>{
    if(released)throw new HttpError(409,'Delivery ownership lost');
    const current=await read();
    if(!('schemaVersion' in current)||current.pid!==record.pid||current.token!==record.token||current.acquiredAt!==record.acquiredAt)throw new HttpError(409,'Delivery ownership lost');
  };
  return {
    identitySha256:crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex'),
    assertOwned,
    release(){
      if(releaseWork)return releaseWork;
      releaseWork=(async()=>{
        await fs.mkdir(guard).catch(()=>{throw new HttpError(409,'Delivery lease recovery or release is already in progress');});
        try{await assertOwned();await fs.unlink(file);released=true;}finally{await fs.rmdir(guard);}
      })();
      return releaseWork;
    },
  };
  }finally{await fs.rmdir(guard);}
}
