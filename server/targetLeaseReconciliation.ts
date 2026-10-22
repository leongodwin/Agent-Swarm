import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const schema=z.strictObject({resource:z.string().min(1).max(8192),owner:z.string().min(1).max(4000),pid:z.number().int().positive().max(2147483647),token:z.uuid(),acquiredAt:z.iso.datetime()});
const absent=(pid:number)=>{try{process.kill(pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}};
const hash=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
/** Audit only. Guard every observed target against cooperating acquire/release;
 * no PID observation or cloud completion authorizes removal of a target lease. */
export async function inspectRetainedTargetLeases(root:string,ownerPid:number,runIds:string[]){
  const stat=await fs.lstat(root).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(stat&&!stat.isDirectory())throw new Error('Target lease root is not a regular directory');
  const names=stat?(await fs.readdir(root)).sort():[];
  if(names.length>1000||names.some(name=>!/^[a-f0-9]{64}\.json$/.test(name)))throw new Error('Target lease inventory is busy, unrecognized or exceeds its bound');
  const guards:string[]=[],original=new Map<string,Buffer>();
  const release=async()=>{for(const guard of guards.reverse())await fs.rmdir(guard);};
  try{
    const rows=[];
    for(const name of names){
      const file=path.join(root,name);if(!(await fs.lstat(file)).isFile())throw new Error('Nonregular target lease');
      const bytes=await readBoundedBytes(file,16384);if(!bytes)throw new Error('Target lease disappeared');
      const record=schema.parse(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:16384}));
      if(name!==hash(record.resource)+'.json')throw new Error('Target lease resource filename mismatch');
      if(record.pid!==ownerPid||!runIds.includes(record.owner)||!absent(record.pid))throw new Error('Live, foreign or unlinked target owner requires independent reconciliation');
      original.set(name,bytes);
      rows.push({recordSha256:hash(bytes),attribution:record.pid===ownerPid&&runIds.includes(record.owner)?'recorded-local-owner':'foreign-or-unlinked',resourceKind:record.resource.startsWith('deployment:')?'deployment':record.resource.startsWith('canvas-authoring:')?'canvas':'other'});
    }
    // Refuse foreign/live owners before touching their guards. Audit must never
    // prevent a healthy owner's release while remote observations are pending.
    for(const name of names){const guard=path.join(root,name+'.reaping');await fs.mkdir(guard);guards.push(guard);}
    const assertUnchanged=async()=>{
      const current=await fs.lstat(root).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
      if(Boolean(current)!==Boolean(stat)||current&&!current.isDirectory())throw new Error('Target lease root changed');
      const inventory=current?(await fs.readdir(root)).filter(name=>!guards.some(guard=>path.basename(guard)===name)).sort():[];
      if(JSON.stringify(inventory)!==JSON.stringify(names))throw new Error('Target lease inventory changed');
      for(const [name,bytes] of original){const file=path.join(root,name);if(!(await fs.lstat(file)).isFile()||!(await readBoundedBytes(file,16384))?.equals(bytes))throw new Error('Target lease ownership changed');}
    };
    await assertUnchanged();
    return {records:[...original].map(([name,bytes])=>({name,bytes})),summary:{scope:'target-lease-observations' as const,leases:rows,resourceLeasesReleased:false as const,resumptionAuthorized:false as const},assertUnchanged,release};
  }catch(error){await release();throw error;}
}
