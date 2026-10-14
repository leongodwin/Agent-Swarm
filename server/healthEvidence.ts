import path from 'node:path';
import type {DeliveryRun} from '../shared/delivery.ts';
import type {HealthEvidenceView} from '../shared/healthEvidence.ts';
import {lifecycleResultSchema,type LifecycleResult,governancePhase} from './lifecycleGovernance.ts';
import {containedFile} from './delivery.ts';
import {readBoundedBytes} from './boundedJson.ts';
import crypto from 'node:crypto';
import {declaredSchemaObservation} from './declaredSchema.ts';
import {HttpError} from './httpError.ts';
import {advancedPolicyObservation} from './advancedPolicy.ts';
import {connectorCatalogueObservation} from './connectorCatalogue.ts';
import {z} from 'zod';

const sha=(content:string|Buffer)=>crypto.createHash('sha256').update(content).digest('hex');
const json=(content:Buffer):unknown=>JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(content));
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const catalogueEvidence=z.strictObject({schemaVersion:z.literal(1),scope:z.literal('package-connector-catalogue-observation'),phase:governancePhase,sourceCommit:z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),releaseId:z.string(),environmentUrl:z.url(),manifestSha256:digest,packageSha256:digest,observation:connectorCatalogueObservation});
interface HealthEvidenceContext {root:string;view:HealthEvidenceView;decision:LifecycleResult;decisionFile:string;decisionContent:Buffer}
function scoped(observed:{phase:string;sourceCommit:string;releaseId:string;environmentUrl:string;manifestSha256:string},decision:LifecycleResult){
  if(observed.phase!==decision.phase||observed.sourceCommit!==decision.sourceCommit||observed.releaseId!==decision.releaseId||observed.environmentUrl!==decision.environmentUrl||observed.manifestSha256!==decision.manifestSha256)throw new Error('Artifact context differs');
}
function freshForDecision(checkedAt:string,decision:LifecycleResult){const age=Date.parse(decision.checkedAt)-Date.parse(checkedAt);if(age>60000||age < -30000)throw new Error('Artifact was not fresh for this decision');}

/** Return captured verified JSON bytes; the HTTP route must not reopen the file for streaming. */
export async function readHealthEvidenceArtifact(context:HealthEvidenceContext,file:string):Promise<Buffer>{
  try{
    const registered=context.view.files.find(item=>item.file===file);if(!registered)throw new Error('Artifact is not registered');
    const content=await readBoundedBytes(await containedFile(context.root,file),registered.kind==='decision'?64*1024:16*1024*1024);if(!content?.length)throw new Error('Artifact missing');
    if(registered.kind==='decision'){if(sha(content)!==sha(context.decisionContent))throw new Error('Decision changed');return content;}
    const expected=registered.kind==='package'?context.decision.packageInventorySha256:file.match(/-([a-f0-9]{64})\.json$/)?.[1];
    if(!expected||sha(content)!==expected)throw new Error('Artifact digest differs');
    const value=json(content);
    if(registered.kind==='schema'){const observed=declaredSchemaObservation.parse(value);scoped(observed,context.decision);freshForDecision(observed.checkedAt,context.decision);}
    else if(registered.kind==='advanced-policy'){const observed=advancedPolicyObservation.parse(value);freshForDecision(observed.checkedAt,context.decision);}
    else if(registered.kind==='connector-catalogue'){const observed=catalogueEvidence.parse(value);scoped(observed,context.decision);if(observed.packageSha256!==context.decision.artifactSha256)throw new Error('Catalogue package differs');freshForDecision(observed.observation.checkedAt,context.decision);}
    else{
      const observed=z.object({schemaVersion:z.literal(1),scope:z.literal('package-metadata-inventory'),packageSha256:digest.or(z.literal('')),archiveComplete:z.boolean(),resourceInventoryComplete:z.boolean(),complianceVerified:z.literal(false)}).parse(value);
      if(!context.decision.artifactSha256||file!==`package-inventory-${context.decision.artifactSha256}.json`||(observed.archiveComplete||observed.packageSha256)&&observed.packageSha256!==context.decision.artifactSha256||!observed.archiveComplete&&observed.resourceInventoryComplete)throw new Error('Package inventory differs from the decision');
    }
    const current=await readBoundedBytes(await containedFile(context.root,context.decisionFile),64*1024);if(!current||sha(current)!==sha(context.decisionContent))throw new Error('Decision changed during artifact read');
    return content;
  }catch{throw new HttpError(404,'Registered health evidence could not be verified for the current decision');}
}

/** Read-only current health evidence; it does not alter the signed release evidence ledger. */
export async function healthEvidenceView(home:string,run:DeliveryRun,options:{includeSchemaSummary?:boolean}={}):Promise<HealthEvidenceContext>{
  try{
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(run.id)||!run.releaseId)throw new Error('No scoped run');
    const name=run.health?.governanceEvidence?.match(/^health\/(governance-\d{1,10}-health\.json)$/)?.[1];if(!name)throw new Error('No current decision');
    const root=path.join(home,'delivery-runs',run.id,'health');
    const decisionContent=await readBoundedBytes(await containedFile(root,name),64*1024);if(!decisionContent?.length)throw new Error('Decision missing');
    const decision=lifecycleResultSchema.parse(json(decisionContent));
    if(decision.phase!=='health'||decision.sourceCommit!==run.head||decision.releaseId!==run.releaseId||decision.environmentUrl!==run.environmentUrl)throw new Error('Health decision context differs');
    const files:HealthEvidenceView['files']=[{file:name,kind:'decision'}];
    for(const [field,kind] of [['packageInventoryFile','package'],['declaredSchemaFile','schema'],['advancedPolicyFile','advanced-policy'],['connectorCatalogueFile','connector-catalogue']] as const){const file=decision[field];if(file&&!files.some(item=>item.file===file))files.push({file,kind});}
    let schema:HealthEvidenceView['schema'];
    const context:HealthEvidenceContext={root,view:{status:decision.status,checkedAt:decision.checkedAt,reasons:decision.reasons,files},decision,decisionFile:name,decisionContent};
    if(decision.declaredSchemaFile&&options.includeSchemaSummary!==false){
      try{
        const content=await readHealthEvidenceArtifact(context,decision.declaredSchemaFile);
        const observed=declaredSchemaObservation.parse(json(content));
        schema={status:observed.status,checkedAt:observed.checkedAt,reason:observed.reason,diagnostic:observed.diagnostic};
      }catch{schema={status:'evidence-unavailable'};}
    }
    return {...context,view:{...context.view,schema}};
  }catch{throw new HttpError(404,'Current health governance evidence is unavailable or does not match the release');}
}
