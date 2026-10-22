import {dataverseGuid} from './targetOperations.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const providerImportBindingSchema=z.strictObject({snapshotSha256:hash,runId:z.string().min(1).max(1000),commandSha256:hash,platformJobId:dataverseGuid,environmentUrl:z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/';}),solution:z.string().min(1).max(200),startedAt:z.iso.datetime()});
const observationSchema=z.object({importjobid:dataverseGuid,solutionname:z.string().max(200),progress:z.number().min(0).max(100),startedon:z.iso.datetime({offset:true}).nullable().optional(),completedon:z.iso.datetime({offset:true}).nullable().optional(),'@odata.nextLink':z.never().optional(),nextLink:z.never().optional()});
async function durable(file:string,value:unknown){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}}
/** Capture exact job observations on every recovery attempt, including pending
 * and unavailable reads. It never dispatches/replays a provider mutation. */
export async function observeProviderImport(root:string,input:unknown,read:()=>Promise<unknown>,guard:()=>Promise<void>){
 const binding=providerImportBindingSchema.parse(input);await guard();const directory=path.join(root,'delivery-provider-history',binding.snapshotSha256);await fs.mkdir(directory,{recursive:true});if(!(await fs.lstat(directory)).isDirectory())throw new Error('Provider history directory must be regular');
 const id=crypto.randomUUID(),intent={schemaVersion:1,id,binding,operation:'read-original-importjob',observedAt:new Date().toISOString(),mutationAllowed:false};await durable(path.join(directory,id+'.intent.json'),intent);await guard();
 let published=false;
 try{let raw:unknown;try{raw=await read();}catch{await guard();throw new Error('Provider ImportJob read unavailable; content withheld');}await guard();let row:z.infer<typeof observationSchema>;try{row=observationSchema.parse(raw);}catch{throw new Error('Provider ImportJob observation malformed; content withheld');}
  if(row.importjobid.toLowerCase()!==binding.platformJobId.toLowerCase()||row.solutionname!==binding.solution||row.startedon&&Date.parse(row.startedon)<Date.parse(binding.startedAt)||row.completedon&&(Date.parse(row.completedon)>Date.now()||!row.startedon||Date.parse(row.completedon)<Date.parse(row.startedon)))throw new Error('Provider ImportJob attribution or chronology differs');
  const terminal=row.progress===100&&Boolean(row.startedon&&row.completedon),observation={schemaVersion:1,id,intentSha256:crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex'),observedAt:new Date().toISOString(),state:terminal?'terminal':'pending-or-unknown',job:row,remoteTerminalityObserved:terminal,deploymentOutcomeVerified:false,replayAuthorized:false};await guard();await durable(path.join(directory,id+'.observation.json'),observation);published=true;await guard();return row;
 }catch(error){if(!published){try{await guard();await durable(path.join(directory,id+'.failure.json'),{schemaVersion:1,id,intentSha256:crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex'),state:'unavailable-or-invalid',observedAt:new Date().toISOString(),remoteTerminalityObserved:false,replayAuthorized:false});await guard();}catch{/* Missing response remains a durable unknown intent; never invent a result. */}}throw error;}
}
