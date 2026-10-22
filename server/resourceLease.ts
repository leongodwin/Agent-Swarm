import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedJson} from './boundedJson.ts';

interface Record { resource: string; owner: string; pid: number; token: string; acquiredAt: string }
const schema=z.strictObject({resource:z.string().min(1).max(8192),owner:z.string().min(1).max(4000),pid:z.number().int().positive().max(2147483647),token:z.uuid(),acquiredAt:z.iso.datetime()});
const sameOwner=(a:Record,b:Record)=>a.resource===b.resource&&a.owner===b.owner&&a.pid===b.pid&&a.token===b.token&&a.acquiredAt===b.acquiredAt;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };

/** Local-machine coordination. A live owner is never displaced by a timeout. */
export async function acquireResourceLease(root: string, resource: string, owner: string, options: { reclaimDeadOwner?: boolean } = {}) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${crypto.createHash('sha256').update(resource).digest('hex')}.json`);
  const guard = `${file}.reaping`;
  const record: Record = schema.parse({ resource, owner, pid: process.pid, token: crypto.randomUUID(), acquiredAt: new Date().toISOString() });
  const bytes=JSON.stringify(record);
  if(Buffer.byteLength(bytes,'utf8')>16*1024)throw new Error('Resource lease identity exceeds its bounded evidence size');
  const read = async () => {
    try{if(!(await fs.lstat(file)).isFile())throw new Error('Nonregular lease');const value=schema.parse(await readBoundedJson(file,16*1024));if(value.resource===resource)return value;}catch{}
    throw new Error(`Invalid resource lease: ${file}; inspect it before recovery`);
  };
  const create = async () => {
    const handle = await fs.open(file, 'wx',0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
  };
  // Fresh acquisition must honor the same guard as release and reconciliation.
  await fs.mkdir(guard).catch(() => { throw new Error(`Resource recovery already in progress: ${guard}`); });
  try {
    if(await fs.lstat(path.join(root,'delivery-handoff.pending')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw new Error('Incomplete delivery handoff holds target acquisition');
    try { await create(); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = await read();
      if (alive(previous.pid)) throw new Error(`Resource ${resource} is owned by ${previous.owner} (PID ${previous.pid})`);
      if (options.reclaimDeadOwner === false) throw new Error(`Resource ${resource} has interrupted owner ${previous.owner}; verify no platform operation is still running before clearing ${file}`);
      const current = await read();
      if (!sameOwner(current,previous) || alive(current.pid)) throw new Error(`Resource ${resource} changed owner during recovery`);
      await fs.unlink(file);
      await create();
    }
  } finally { await fs.rmdir(guard); }
  let released = false,lost=false,releaseWork:Promise<void>|undefined;
  const assertOwned = async () => {
    if(released||lost)throw new Error(`Resource ownership lost: ${resource}`);
    try{if(!sameOwner(await read(),record))throw new Error('Owner changed');}catch{lost=true;throw new Error(`Resource ownership lost: ${resource}`);}
  };
  return {
    token: record.token, assertOwned,
    release() {
      if(releaseWork)return releaseWork;
      releaseWork=(async()=>{
        await fs.mkdir(guard).catch(()=>{releaseWork=undefined;throw new Error(`Resource release or recovery already in progress: ${guard}`);});
        try{await assertOwned();await fs.unlink(file);released=true;}finally{await fs.rmdir(guard);}
      })();
      return releaseWork;
    },
  };
}

export async function withResourceLease<T>(root: string, resource: string, owner: string, fn: (lease: Awaited<ReturnType<typeof acquireResourceLease>>) => Promise<T>): Promise<T> {
  const lease = await acquireResourceLease(root, resource, owner);
  try { return await fn(lease); } finally { await lease.release(); }
}

/** Accept only a durable handoff addressed to this process and exact owner.
 * Does not create, reap, replace or clear a lease. */
export async function acceptResourceLeaseTransfer(root:string,resource:string,owner:string,expectedSha256:string){
 const file=path.join(root,`${crypto.createHash('sha256').update(resource).digest('hex')}.json`),guard=file+'.reaping';let released=false;
 const assertOwned=async()=>{
  if(released||await fs.lstat(guard).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Resource handoff remains blocked');
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Transferred lease path differs');
  const bytes=await fs.readFile(file);if(bytes.length>16384||crypto.createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('Transferred lease changed');
  const row=schema.parse(JSON.parse(bytes.toString('utf8')));if(row.pid!==process.pid||row.resource!==resource||row.owner!==owner)throw Error('Transferred lease belongs to another owner');return row;
 };const row=await assertOwned();
 return{token:row.token,assertOwned:async()=>{await assertOwned();},release:async()=>{
  await assertOwned();await fs.mkdir(guard).catch(()=>{throw Error('Resource release or recovery already in progress');});
  try{const bytes=await fs.readFile(file);if(crypto.createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('Transferred lease changed during release');await fs.unlink(file);released=true;}finally{await fs.rmdir(guard);}
 }};
}
