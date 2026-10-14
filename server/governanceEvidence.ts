import path from 'node:path';
import {deliveryGovernancePhases,type GovernanceEvidenceView} from '../shared/governanceEvidence.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
import {lifecycleResultSchema} from './lifecycleGovernance.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {containedFile} from './delivery.ts';

/** Read the latest registered historical decision for each stage, never falling back over a missing newer record. */
export async function governanceEvidenceView(home:string,run:DeliveryRun):Promise<GovernanceEvidenceView> {
  const captured=structuredClone(run);
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(captured.id)||!captured.releaseId)throw new Error('Scoped delivery run is required');
  const stages=await Promise.all(deliveryGovernancePhases.map(async phase=>{
    const candidates=phase==='health'?[captured.health?.governanceEvidence??'']:captured.evidence;
    const pattern=phase==='health'?/^health\/(governance-(\d{1,10})-health\.json)$/:new RegExp(`^(governance-(\\d{1,10})-${phase}\\.json)$`);
    if(candidates.some(file=>phase==='health'?!!file&&!pattern.test(file):file.startsWith('governance-')&&file.endsWith(`-${phase}.json`)&&!pattern.test(file)))return {phase,status:'evidence-unavailable' as const,reasons:['A registered stage decision has an invalid evidence name']};
    const files=candidates.map(file=>({file,match:file.match(pattern)})).filter(row=>row.match).sort((a,b)=>Number(b.match![2])-Number(a.match![2]));
    const file=files[0]?.file;
    if(!file)return {phase,status:'not-recorded' as const,reasons:['No registered decision for this stage']};
    try{
      const root=path.join(home,'delivery-runs',captured.id,phase==='health'?'health':'evidence'),name=files[0].match![1];
      const content=await readBoundedBytes(await containedFile(root,name),64*1024);
      if(!content?.length)throw new Error();
      const decision=lifecycleResultSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content)));
      if(decision.phase!==phase||decision.sourceCommit!==captured.head||decision.releaseId!==captured.releaseId||decision.environmentUrl!==captured.environmentUrl||decision.artifactSha256&&captured.recovery&&['import','post-deploy','verify','health'].includes(phase)&&decision.artifactSha256!==captured.recovery.packageSha256)throw new Error();
      return {phase,file,status:decision.status,checkedAt:decision.checkedAt,reasons:decision.reasons,artifactSha256:decision.artifactSha256,settingsSha256:decision.settingsSha256};
    }catch{return {phase,file,status:'evidence-unavailable' as const,reasons:['Latest registered decision is unreadable, incomplete or differs from this run']};}
  }));
  if(JSON.stringify(run)!==JSON.stringify(captured))throw new Error('Delivery scope changed during evidence observation');
  return {scope:'historical-governance-decisions',stages};
}
