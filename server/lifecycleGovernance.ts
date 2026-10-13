import crypto from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from './atomicFile.ts';
import path from 'node:path';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const governancePhase=z.enum(['build','test','import','post-deploy','verify','health']);
export type GovernancePhase=z.infer<typeof governancePhase>;
export interface LifecycleRequest {
  phase:GovernancePhase;sourceCommit:string;environmentUrl:string;releaseId:string;checkout:string;manifest:unknown;packageSha256?:string;signal?:AbortSignal;
}
const resultSchema=z.object({status:z.enum(['clear','blocked','unavailable']),phase:governancePhase,sourceCommit:digest.or(z.string().regex(/^[a-f0-9]{40}$/)),
  environmentUrl:z.url(),releaseId:z.string().min(1),manifestSha256:digest,checkedAt:z.iso.datetime(),
  artifactSha256:digest.optional(),policySha256:digest.optional(),schemaSha256:digest.optional(),
  reasons:z.array(z.string().min(1).max(1000)).min(1).max(30),
}).strict().superRefine((result,ctx)=>{if(result.status==='clear'&&(!result.artifactSha256||!result.policySha256||!result.schemaSha256))ctx.addIssue({code:'custom',message:'Clear governance requires complete artifact, policy and schema evidence'});});
export type LifecycleResult=z.infer<typeof resultSchema>;
export type LifecycleCheck=(request:LifecycleRequest)=>Promise<LifecycleResult>;
export function manifestDigest(manifest:unknown) {return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');}
export function unavailableGovernance(request:LifecycleRequest,reasons=['Complete artifact inventory, advanced tenant policy evaluation and comprehensive schema contracts are not available']):LifecycleResult {
  return {status:'unavailable',phase:request.phase,sourceCommit:request.sourceCommit,environmentUrl:request.environmentUrl,releaseId:request.releaseId,manifestSha256:manifestDigest(request.manifest),checkedAt:new Date().toISOString(),reasons};
}
/** Persist a context-bound decision before the caller may execute its stage.
 * Unconfigured providers, exceptions, mismatched evidence and stale approvals cannot permit execution. */
export async function requireLifecycleGovernance(check:LifecycleCheck|undefined,request:LifecycleRequest,evidenceDirectory:string,index:number,now?:number) {
  let result:LifecycleResult;
  try {
    if(request.signal?.aborted) throw new Error('cancelled');
    const controller=new AbortController();
    const value=await new Promise<LifecycleResult>((resolve,reject)=>{
      const cancel=()=>{controller.abort();reject(new Error('cancelled'));};
      const timer=setTimeout(cancel,60_000);
      request.signal?.addEventListener('abort',cancel,{once:true});
      Promise.resolve().then(()=>(check??(async request=>unavailableGovernance(request)))({...request,signal:controller.signal})).then(resolve,reject).finally(()=>{clearTimeout(timer);request.signal?.removeEventListener('abort',cancel);});
      controller.signal.addEventListener('abort',()=>{clearTimeout(timer);request.signal?.removeEventListener('abort',cancel);},{once:true});
    });
    if(request.signal?.aborted) throw new Error('cancelled');
    result=resultSchema.parse(value);
    const evaluatedAt=now??Date.now();
    if(result.phase!==request.phase||result.sourceCommit!==request.sourceCommit||result.environmentUrl!==request.environmentUrl||result.releaseId!==request.releaseId||result.manifestSha256!==manifestDigest(request.manifest)||(result.status==='clear'&&request.packageSha256&&result.artifactSha256!==request.packageSha256)||evaluatedAt-Date.parse(result.checkedAt)>60_000||Date.parse(result.checkedAt)>evaluatedAt+30_000) throw new Error('mismatch');
  } catch {result=unavailableGovernance(request,['Governance provider failed or returned stale, incomplete or mismatched evidence']);}
  const file=`governance-${index}-${request.phase}.json`;
  await atomicWrite(path.join(evidenceDirectory,file),JSON.stringify(result,null,2));
  if(request.signal?.aborted) throw new Error(`Lifecycle governance unavailable at ${request.phase}: execution was cancelled`);
  if(result.status!=='clear') throw new Error(`Lifecycle governance ${result.status} at ${request.phase}: ${result.reasons.join('; ')}`);
  return file;
}
