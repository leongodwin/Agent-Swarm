import path from 'node:path';
import type {DeliveryRun} from '../shared/delivery.ts';
import type {HealthEvidenceView} from '../shared/healthEvidence.ts';
import {lifecycleResultSchema} from './lifecycleGovernance.ts';
import {containedFile} from './delivery.ts';
import {readBoundedJson} from './boundedJson.ts';
import {readBoundedText} from './boundedJson.ts';
import crypto from 'node:crypto';
import {declaredSchemaObservation} from './declaredSchema.ts';
import {HttpError} from './httpError.ts';

/** Read-only current health evidence; it does not alter the signed release evidence ledger. */
export async function healthEvidenceView(home:string,run:DeliveryRun):Promise<{root:string;view:HealthEvidenceView}>{
  try{
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(run.id)||!run.releaseId)throw new Error('No scoped run');
    const name=run.health?.governanceEvidence?.match(/^health\/(governance-\d{1,10}-health\.json)$/)?.[1];if(!name)throw new Error('No current decision');
    const root=path.join(home,'delivery-runs',run.id,'health');
    const decision=lifecycleResultSchema.parse(await readBoundedJson(await containedFile(root,name),64*1024));
    if(decision.phase!=='health'||decision.sourceCommit!==run.head||decision.releaseId!==run.releaseId||decision.environmentUrl!==run.environmentUrl)throw new Error('Health decision context differs');
    const files:HealthEvidenceView['files']=[{file:name,kind:'decision'}];
    for(const [field,kind] of [['packageInventoryFile','package'],['declaredSchemaFile','schema'],['advancedPolicyFile','advanced-policy'],['connectorCatalogueFile','connector-catalogue']] as const){const file=decision[field];if(file&&!files.some(item=>item.file===file))files.push({file,kind});}
    let schema:HealthEvidenceView['schema'];
    if(decision.declaredSchemaFile){
      try{
        const content=await readBoundedText(await containedFile(root,decision.declaredSchemaFile),16*1024*1024);
        if(!content||`declared-schema-${crypto.createHash('sha256').update(content).digest('hex')}.json`!==decision.declaredSchemaFile)throw new Error('Schema digest differs');
        const observed=declaredSchemaObservation.parse(JSON.parse(content));
        if(observed.phase!==decision.phase||observed.sourceCommit!==decision.sourceCommit||observed.releaseId!==decision.releaseId||observed.environmentUrl!==decision.environmentUrl||observed.manifestSha256!==decision.manifestSha256)throw new Error('Schema context differs');
        const age=Date.parse(decision.checkedAt)-Date.parse(observed.checkedAt);if(age>60_000||age < -30_000)throw new Error('Schema observation was not fresh for this decision');
        schema={status:observed.status,checkedAt:observed.checkedAt,reason:observed.reason,diagnostic:observed.diagnostic};
      }catch{schema={status:'evidence-unavailable'};}
    }
    return {root,view:{status:decision.status,checkedAt:decision.checkedAt,reasons:decision.reasons,files,schema}};
  }catch{throw new HttpError(404,'Current health governance evidence is unavailable or does not match the release');}
}
