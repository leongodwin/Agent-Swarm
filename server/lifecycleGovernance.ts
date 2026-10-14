import crypto from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from './atomicFile.ts';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import type {ResourceSchemaReference} from './flowSchemaReferences.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const governancePhase=z.enum(['build','test','import','post-deploy','verify','health']);
export type GovernancePhase=z.infer<typeof governancePhase>;
export interface LifecycleRequest {
  phase:GovernancePhase;sourceCommit:string;environmentUrl:string;releaseId:string;checkout:string;manifest:unknown;packageSha256?:string;signal?:AbortSignal;evidenceDirectory?:string;resourceSchemaReferences?:ResourceSchemaReference[];
}
const resultSchema=z.object({status:z.enum(['clear','blocked','unavailable']),phase:governancePhase,sourceCommit:digest.or(z.string().regex(/^[a-f0-9]{40}$/)),
  environmentUrl:z.url(),releaseId:z.string().min(1),manifestSha256:digest,checkedAt:z.iso.datetime(),
  artifactSha256:digest.optional(),policySha256:digest.optional(),schemaSha256:digest.optional(),
  packageInventoryFile:z.string().regex(/^package-inventory-[a-f0-9]{64}\.json$/).optional(),
  packageInventorySha256:digest.optional(),
  declaredSchemaFile:z.string().regex(/^declared-schema-[a-f0-9]{64}\.json$/).optional(),
  advancedPolicyFile:z.string().regex(/^advanced-policy-[a-f0-9]{64}\.json$/).optional(),
  connectorCatalogueFile:z.string().regex(/^connector-catalogue-[a-f0-9]{64}\.json$/).optional(),
  reasons:z.array(z.string().min(1).max(1000)).min(1).max(30),
}).strict().superRefine((result,ctx)=>{
  if(result.status==='clear'&&(!result.artifactSha256||!result.policySha256||!result.schemaSha256))ctx.addIssue({code:'custom',message:'Clear governance requires complete artifact, policy and schema evidence'});
  if(result.packageInventorySha256&&!result.packageInventoryFile||result.packageInventoryFile&&result.artifactSha256&&result.packageInventoryFile!==`package-inventory-${result.artifactSha256}.json`)ctx.addIssue({code:'custom',message:'Package inventory digest and pointer must match the recorded artifact'});
  if(result.status==='clear'&&result.packageInventoryFile&&!result.packageInventorySha256)ctx.addIssue({code:'custom',message:'Clear governance requires a content digest for its package inventory'});
});
export type LifecycleResult=z.infer<typeof resultSchema>;
export const lifecycleResultSchema=resultSchema;
export type LifecycleCheck=(request:LifecycleRequest)=>Promise<LifecycleResult>;
export function manifestDigest(manifest:unknown) {return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');}
export function unavailableGovernance(request:LifecycleRequest,reasons=['Complete artifact inventory, advanced tenant policy evaluation and comprehensive schema contracts are not available']):LifecycleResult {
  return {status:'unavailable',phase:request.phase,sourceCommit:request.sourceCommit,environmentUrl:request.environmentUrl,releaseId:request.releaseId,manifestSha256:manifestDigest(request.manifest),checkedAt:new Date().toISOString(),reasons};
}
/** Persist a context-bound decision before the caller may execute its stage.
 * Unconfigured providers, exceptions, mismatched evidence and stale approvals cannot permit execution. */
export async function requireLifecycleGovernance(check:LifecycleCheck|undefined,request:LifecycleRequest,evidenceDirectory:string,index:number,now?:number,onCancellationPending?:(reason:'deadline'|'cancelled')=>void|Promise<void>) {
  const started=performance.now(),startedWall=now??Date.now();
  const current=(at:number)=>{const elapsed=performance.now()-started;return elapsed>=0&&elapsed<60000&&at>=startedWall;};
  const fresh=(value:LifecycleResult,at:number)=>at-Date.parse(value.checkedAt)<=60000&&Date.parse(value.checkedAt)<=at+30000;
  const authorized=(value:LifecycleResult)=>{const at=now??Date.now();return !request.signal?.aborted&&current(at)&&fresh(value,at);};
  let result:LifecycleResult;
  try {
    if(request.signal?.aborted) throw new Error('cancelled');
    const controller=new AbortController();
    let cancellationNotice:Promise<void>|undefined;
    const cancel=(reason:'deadline'|'cancelled')=>{
      if(controller.signal.aborted)return;
      controller.abort();
      // Handle reporting failures immediately, but do not release provider ownership.
      cancellationNotice=Promise.resolve().then(()=>onCancellationPending?.(reason)).then(()=>undefined,()=>undefined);
    };
    const abort=()=>cancel('cancelled'),timer=setTimeout(()=>cancel('deadline'),60_000);
    request.signal?.addEventListener('abort',abort,{once:true});
    let value:LifecycleResult;
    try{
      // A timeout revokes authority, not the outstanding provider task. Await its
      // settlement so the caller retains delivery/resource leases through cleanup.
      value=await Promise.resolve().then(()=>{
        if(request.signal?.aborted)abort();
        if(controller.signal.aborted)throw new Error('cancelled');
        return (check??(async request=>unavailableGovernance(request)))({...request,signal:controller.signal});
      });
    }finally{
      clearTimeout(timer);request.signal?.removeEventListener('abort',abort);
      if(cancellationNotice)await cancellationNotice;
    }
    if(controller.signal.aborted||request.signal?.aborted) throw new Error('cancelled');
    result=resultSchema.parse(value);
    const evaluatedAt=now??Date.now();
    if(!current(evaluatedAt)||!fresh(result,evaluatedAt)||result.phase!==request.phase||result.sourceCommit!==request.sourceCommit||result.environmentUrl!==request.environmentUrl||result.releaseId!==request.releaseId||result.manifestSha256!==manifestDigest(request.manifest)||(result.status==='clear'&&request.packageSha256&&result.artifactSha256!==request.packageSha256)) throw new Error('mismatch');
  } catch {result=unavailableGovernance(request,['Governance provider failed or returned stale, incomplete or mismatched evidence']);}
  const file=`governance-${index}-${request.phase}.json`;
  try{await atomicWrite(path.join(evidenceDirectory,file),JSON.stringify(result,null,2),()=>result.status!=='clear'||authorized(result));}
  catch(error){if(result.status!=='clear'||authorized(result))throw error;}
  if(result.status==='clear'&&!authorized(result)){
    result=unavailableGovernance(request,['Governance authority expired or execution was cancelled while persisting its audit; repeat the stage with current evidence']);
    await atomicWrite(path.join(evidenceDirectory,file),JSON.stringify(result,null,2));
  }
  if(request.signal?.aborted) throw new Error(`Lifecycle governance unavailable at ${request.phase}: execution was cancelled`);
  if(result.status!=='clear') throw new Error(`Lifecycle governance ${result.status} at ${request.phase}: ${result.reasons.join('; ')}`);
  return file;
}
