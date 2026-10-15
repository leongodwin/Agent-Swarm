import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {validateDeliveryState} from './deliveryState.ts';
import {HttpError} from './httpError.ts';
import type {DeliveryRecoveryInspection} from '../shared/deliveryRecovery.ts';
const leaseSchema=z.strictObject({schemaVersion:z.literal(1),pid:z.number().int().positive().max(2147483647),token:z.uuid(),acquiredAt:z.iso.datetime()});
function absent(pid:number){try{process.kill(pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}}
async function regularBytes(file:string,max:number){const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});if(stat&&!stat.isFile())throw new Error('Nonregular recovery file');return readBoundedBytes(file,max);}
async function inspect(root:string):Promise<{view:DeliveryRecoveryInspection;leaseBytes?:Buffer;stateBytes?:Buffer}>{
  const view:DeliveryRecoveryInspection={scope:'local-delivery-startup',observedAt:new Date().toISOString(),owner:'invalid',history:'invalid',canRecover:false,reason:'Delivery ownership or history is unreadable. Preserve the files and investigate.'};
  let leaseBytes:Buffer|undefined,stateBytes:Buffer|undefined,noCloudHistory=false;
  try{leaseBytes=await regularBytes(path.join(root,'delivery.lock'),16384);if(!leaseBytes)view.owner='missing';else{const lease=leaseSchema.parse(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(leaseBytes),{maxBytes:16384}));view.owner=absent(lease.pid)?'absent':'live-or-unverifiable';}}catch{/* No raw data or ownership token leaves inspection. */}
  try{stateBytes=await regularBytes(path.join(root,'delivery.json'),16*1024*1024);if(!stateBytes)view.history='missing';else{const state=validateDeliveryState(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(stateBytes),{maxBytes:16*1024*1024}));noCloudHistory=!state.runs.length&&!state.releases.length&&!state.attemptHistory?.attempts.length;view.history=noCloudHistory&&!state.blockers.length?'empty':'retained';}}catch{/* Invalid history can never authorize recovery. */}
  if(view.owner==='absent'&&noCloudHistory&&leaseBytes&&stateBytes){view.canRecover=true;view.snapshotSha256=crypto.createHash('sha256').update(leaseBytes).update('\0').update(stateBytes).digest('hex');view.reason=`The recorded process is absent and validated history has no releases, runs or attempts${view.history==='retained'?' (blocker observations are retained)':''}. Recovering preserves all history and the interrupted marker and starts delivery in maintenance mode.`;}
  else if(view.owner==='live-or-unverifiable')view.reason='Another process may own delivery. Inspect its process identity; takeover is disabled.';
  else if(view.history==='retained')view.reason='Retained delivery history requires independent reconciliation of outstanding cloud operations. No automatic lock removal is allowed.';
  else if(view.owner==='missing')view.reason='The ownership marker is absent. Retry startup after investigating the original initialization error.';
  return {view,leaseBytes,stateBytes};
}
export async function inspectDeliveryRecovery(root:string){return (await inspect(root)).view;}
/** Explicit empty-history recovery only. Nonempty history needs remote outcome
 * reconciliation; a dead PID alone never authorizes takeover. */
export async function recoverEmptyDelivery(root:string,expectedSha256:string,assertOpen:()=>void=()=>{}){
  assertOpen();
  const guard=path.join(root,'delivery.lock.reaping');
  await fs.mkdir(guard).catch(()=>{throw new HttpError(409,'Delivery ownership recovery or release is already in progress');});
  try{
    assertOpen();const first=await inspect(root);assertOpen();
    if(!first.view.canRecover||first.view.snapshotSha256!==expectedSha256)throw new HttpError(409,'Delivery recovery evidence changed or requires independent reconciliation');
    const archive=path.join(root,'delivery-recovery');await fs.mkdir(archive,{recursive:true});if(!(await fs.lstat(archive)).isDirectory())throw new HttpError(409,'Recovery archive is not a regular directory');assertOpen();
    const second=await inspect(root);assertOpen();
    if(!second.view.canRecover||second.view.snapshotSha256!==expectedSha256)throw new HttpError(409,'Delivery recovery evidence changed');
    const id=crypto.randomUUID(),marker=path.join(archive,`${id}.lock.json`);
    // Preserve an audit record before moving the exact marker. Recovery never
    // deletes history, retries a cloud operation or clears another owner.
    await fs.writeFile(path.join(archive,`${id}.json`),JSON.stringify({schemaVersion:1,scope:'no-cloud-operation-history',at:new Date().toISOString(),snapshotSha256:expectedSha256,runs:0,releases:0,attempts:0,blockerObservationsPreserved:first.view.history==='retained',remoteOutcomeVerified:false}),{flag:'wx',mode:0o600});
    const final=await inspect(root);if(!final.view.canRecover||final.view.snapshotSha256!==expectedSha256)throw new HttpError(409,'Delivery recovery evidence changed');
    assertOpen();await fs.rename(path.join(root,'delivery.lock'),marker);
  }finally{await fs.rmdir(guard);}
}
