import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite,SerialWriter} from './atomicFile.ts';
import {readBoundedJson,readBoundedBytes} from './boundedJson.ts';
import {HttpError} from './httpError.ts';
import type {LifecycleRequest,LifecycleResult} from './lifecycleGovernance.ts';
import {manifestDigest} from './lifecycleGovernance.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const manualControls=['package-scope','effective-policy','schema-and-permissions','licence-baseline','recovery-and-data'] as const;
const evidence=z.strictObject({file:z.string().min(1).max(4000),sha256:digest});
const providerFacts=z.strictObject({artifactSha256:digest,policySha256:digest,schemaSha256:digest,inventorySha256:digest,advancedSha256:digest});
const factsSchema=providerFacts.extend({implementationSha256:digest});
const reviewSchema=z.strictObject({reviewer:z.string(),decision:z.enum(['approved','rejected']),notes:z.string().min(80).max(8000),controls:z.array(z.enum(manualControls)).length(manualControls.length),at:z.iso.datetime()});
const assessment=z.strictObject({id:z.uuid(),repoId:z.string(),releaseId:z.string(),planHash:digest,manifestSha256:digest,sourceCommit:z.string().regex(/^[a-f0-9]{40,64}$/),environmentUrl:z.url(),phase:z.enum(['build','test','import','post-deploy','verify','health']),facts:factsSchema,evidence:z.array(evidence).min(1).max(30),bindingSha256:digest,observedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  review:reviewSchema.optional(),reviewHistory:z.array(reviewSchema).max(100).default([])});
const state=z.strictObject({schemaVersion:z.literal(1),assessments:z.array(assessment).max(1000)}).superRefine((value,ctx)=>{
  const seen=new Set<string>();for(const row of value.assessments){
    const binding={releaseId:row.releaseId,planHash:row.planHash,manifestSha256:row.manifestSha256,sourceCommit:row.sourceCommit,environmentUrl:row.environmentUrl,phase:row.phase,facts:row.facts};
    if(seen.has(row.id)||crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex')!==row.bindingSha256||Date.parse(row.expiresAt)<=Date.parse(row.observedAt)||Date.parse(row.expiresAt)-Date.parse(row.observedAt)>30*60000||row.review&&(new Set(row.review.controls).size!==manualControls.length||JSON.stringify(row.review)!==JSON.stringify(row.reviewHistory.at(-1))))ctx.addIssue({code:'custom',message:'Manual assessment identity, scope, validity or review is inconsistent'});seen.add(row.id);
  }
});
type Assessment=z.infer<typeof assessment>;
export interface ManualRelease {repoId:string;head:string;environmentUrl:string;planHash:string;plan:{owner:string;qaOwner:string;acceptanceProfile?:string}}
/** A separate, explicit development assessment. It never turns an unknown
 * automated check into a verified automated control or authorises production. */
export class ManualGovernance {
  private rows:Assessment[]=[];
  private writer=new SerialWriter();
  private ready=false;
  constructor(private root:string,private release:(id:string)=>ManualRelease|undefined,private assertOpen:()=>void,private implementation:{sha256:string;evidence:z.infer<typeof evidence>[]}){digest.parse(implementation.sha256);z.array(evidence).min(1).parse(implementation.evidence);}
  async init(){const saved=await readBoundedJson(path.join(this.root,'manual-governance.json'),4*1024*1024);this.rows=saved===undefined?[]:state.parse(saved).assessments;this.ready=true;}
  private check(){if(!this.ready)throw new HttpError(503,'Manual governance storage unavailable');this.assertOpen();}
  private async save(rows:Assessment[],guard:()=>void=()=>{}){this.check();guard();const parsed=state.parse({schemaVersion:1,assessments:rows});const text=JSON.stringify(parsed,null,2);if(Buffer.byteLength(text)>4*1024*1024)throw new HttpError(413,'Preserve manual assessment history before adding more');await atomicWrite(path.join(this.root,'manual-governance.json'),text,()=>{this.check();guard();return true;});this.rows=parsed.assessments;}
  view(repoId:string){if(!this.ready)throw new HttpError(503,'Manual governance storage unavailable');return structuredClone(this.rows.filter(row=>row.repoId===repoId));}
  async observe(request:LifecycleRequest,rawFacts:z.infer<typeof providerFacts>,files:z.infer<typeof evidence>[]):Promise<LifecycleResult|undefined>{
    return this.writer.write(async()=>{
      this.check();const release=this.release(request.releaseId);
      if(request.acceptanceProfile!=='functional-development'||release?.plan.acceptanceProfile!=='functional-development'||release.head!==request.sourceCommit||release.environmentUrl!==request.environmentUrl)return undefined;
      const facts=factsSchema.parse({...rawFacts,implementationSha256:this.implementation.sha256});files=z.array(evidence).min(1).max(30).parse([...files,...this.implementation.evidence]);
      const phase=request.phase;const binding={releaseId:request.releaseId,planHash:release.planHash,manifestSha256:manifestDigest(request.manifest),sourceCommit:request.sourceCommit,environmentUrl:request.environmentUrl,phase,facts};
      const bindingSha256=crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex'),now=Date.now();
      let row=this.rows.find(row=>row.bindingSha256===bindingSha256&&Date.parse(row.observedAt)<=now+30000&&Date.parse(row.expiresAt)>now);
      if(!row){row=assessment.parse({id:crypto.randomUUID(),repoId:release.repoId,...binding,evidence:files,bindingSha256,observedAt:new Date(now).toISOString(),expiresAt:new Date(now+30*60000).toISOString()});await this.save([...this.rows,row]);}
      request.signal?.throwIfAborted();if(this.release(request.releaseId)?.planHash!==release.planHash)return undefined;
      if(row.review?.decision!=='approved'||Date.parse(row.review.at)>Date.now()+30000||row.review.reviewer!==release.plan.qaOwner||row.review.reviewer===release.plan.owner)return undefined;
      for(const receipt of row.evidence){const bytes=await readBoundedBytes(receipt.file,16*1024*1024);request.signal?.throwIfAborted();if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==receipt.sha256)throw new HttpError(409,'Approved manual assessment evidence changed or is unavailable');}
      if(Date.parse(row.expiresAt)<=Date.now()||this.release(request.releaseId)?.planHash!==release.planHash)return undefined;
      const manualAssessmentFile=request.evidenceDirectory?`manual-assessment-${row.id}.json`:undefined;
      if(manualAssessmentFile)await atomicWrite(path.join(request.evidenceDirectory!,manualAssessmentFile),JSON.stringify(row,null,2),()=>{this.check();request.signal?.throwIfAborted();return Date.parse(row!.expiresAt)>Date.now()&&this.release(request.releaseId)?.planHash===release.planHash;});
      return {status:'clear',phase:request.phase,releaseId:request.releaseId,sourceCommit:request.sourceCommit,environmentUrl:request.environmentUrl,manifestSha256:binding.manifestSha256,checkedAt:new Date().toISOString(),artifactSha256:facts.artifactSha256,policySha256:facts.policySha256,schemaSha256:facts.schemaSha256,settingsSha256:request.settingsSha256,assurance:'manual-functional-development',manualAssessmentId:row.id,manualAssessmentFile,reasons:['Assigned independent QA approved the exact bounded manual development assessment; automated comprehensive governance, production readiness and employee isolation are not certified']};
    });
  }
  async review(repoId:string,id:string,reviewer:string,input:unknown,guard:()=>void=()=>{}){
    return this.writer.write(async()=>{
      this.check();guard();const row=this.rows.find(row=>row.id===id&&row.repoId===repoId);if(!row)throw new HttpError(404,'Manual assessment not found in this project');
      const release=this.release(row.releaseId);if(!release||release.plan.qaOwner!==reviewer||release.plan.owner===reviewer||release.head!==row.sourceCommit||release.planHash!==row.planHash||release.environmentUrl!==row.environmentUrl||release.plan.acceptanceProfile!=='functional-development')throw new HttpError(403,'Only assigned independent QA can review this exact development release');
      if(Date.parse(row.expiresAt)<=Date.now()||Date.parse(row.observedAt)>Date.now()+30000)throw new HttpError(409,'Manual assessment expired or clock changed; repeat the stage for fresh evidence');
      const review=assessment.shape.review.unwrap().omit({reviewer:true,at:true}).parse(input);if(new Set(review.controls).size!==manualControls.length)throw new HttpError(400,'Review every required manual control exactly once');
      for(const receipt of row.evidence){const bytes=await readBoundedBytes(receipt.file,16*1024*1024);if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==receipt.sha256)throw new HttpError(409,'Manual assessment evidence changed or is unavailable');}
      const current=()=>{this.check();guard();const current=this.release(row.releaseId);if(Date.parse(row.expiresAt)<=Date.now()||current?.planHash!==row.planHash||current.plan.qaOwner!==reviewer||current.plan.owner===reviewer)throw new HttpError(409,'Manual assessment authority changed during evidence reads');};current();
      const decision={...review,reviewer,at:new Date().toISOString()},next={...row,review:decision,reviewHistory:[...row.reviewHistory,decision]};await this.save(this.rows.map(value=>value.id===id?next:value),current);return structuredClone(next);
    });
  }
  async close(){this.ready=false;await this.writer.drain();}
}
