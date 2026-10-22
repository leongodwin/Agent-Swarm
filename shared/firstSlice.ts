import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const firstSliceSchema=z.strictObject({schemaVersion:z.literal(1),
  components:z.array(z.strictObject({componentId:id,targetKey:id,platform:z.enum(['dataverse','sharepoint','canvas','flow','model-driven','power-pages','code-apps','copilot-studio','other'])})).min(1).max(100),
  cases:z.array(z.strictObject({checkId:id,scenarioId:id,testName:z.string().trim().min(1).max(200)})).min(3).max(200),
}).superRefine((value,ctx)=>{
  if(new Set(value.components.map(c=>c.componentId)).size!==value.components.length||new Set(value.components.map(c=>c.targetKey)).size!==value.components.length)ctx.addIssue({code:'custom',message:'First-slice component mappings must be unique'});
  for(const row of value.cases)if(value.cases.some(other=>other.testName===row.testName&&other.scenarioId!==row.scenarioId))ctx.addIssue({code:'custom',message:'Distinct first-slice scenarios require distinct executable tests'});
  if(new Set(value.cases.map(c=>`${c.checkId}:${c.scenarioId}`)).size!==value.cases.length)ctx.addIssue({code:'custom',message:'Duplicate first-slice check/scenario mapping'});
});
export const firstSliceResultSchema=z.strictObject({schemaVersion:z.literal(1),observedAfter:z.iso.datetime(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),evidenceFile:z.literal('first-slice-verification.json')});
