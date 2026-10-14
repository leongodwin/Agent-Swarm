import path from 'node:path';
import type {DeliveryRun} from '../shared/delivery.ts';
import type {HealthEvidenceView} from '../shared/healthEvidence.ts';
import {lifecycleResultSchema} from './lifecycleGovernance.ts';
import {containedFile} from './delivery.ts';
import {readBoundedJson} from './boundedJson.ts';
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
    for(const [field,kind] of [['packageInventoryFile','package'],['declaredSchemaFile','schema'],['advancedPolicyFile','advanced-policy']] as const){const file=decision[field];if(file&&!files.some(item=>item.file===file))files.push({file,kind});}
    return {root,view:{status:decision.status,checkedAt:decision.checkedAt,reasons:decision.reasons,files}};
  }catch{throw new HttpError(404,'Current health governance evidence is unavailable or does not match the release');}
}
