import type {QualityContract} from '../../shared/qualityEvidence.ts';
export function qualityContract(components:QualityContract['components']=[{componentId:'data',targetKey:'expenses',platform:'dataverse'}],names=['journey 0','authorization 1','error-handling 3']):QualityContract{
  const cases=['happy','denied','failure'].map((scenarioId,i)=>({scenarioId,testName:names[i]}));
  return {schemaVersion:1,components,checks:[{checkId:'compile',kind:'compile',phase:'test',commandIndex:0},{checkId:'package',kind:'package'},{checkId:'runtime',kind:'runtime',cases},{checkId:'access',kind:'access',cases:[cases[1]]},{checkId:'recovery',kind:'recovery'},...(['user','administrator','operations','architecture'] as const).map(role=>({checkId:`doc-${role}`,kind:'documentation' as const,document:{role,file:`${role}.md`,sections:['Purpose','Procedure','Limitations']}}))]};
}
export const qualityDocument=(role:string)=>`# ${role} handover\n## Purpose\nExplain the intended audience and supported outcome.\n## Procedure\nFollow the reviewed application workflow and verify persisted results.\n## Limitations\nProduction permissions and real tenant behavior require independent runtime evidence.\n`;
