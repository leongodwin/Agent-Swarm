import {z} from 'zod';
import {firstSliceSchema} from './firstSlice.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const qualityKinds=['compile','package','runtime','access','recovery','documentation'] as const;
const cases=z.array(z.strictObject({scenarioId:id,testName:z.string().trim().min(1).max(200)})).min(1).max(100);
export const qualityContractSchema=z.strictObject({schemaVersion:z.literal(1),components:firstSliceSchema.shape.components,
  checks:z.array(z.discriminatedUnion('kind',[
    z.strictObject({checkId:id,kind:z.literal('compile'),phase:z.enum(['build','test']),commandIndex:z.number().int().min(0).max(9)}),
    z.strictObject({checkId:id,kind:z.literal('package')}),z.strictObject({checkId:id,kind:z.literal('runtime'),cases}),z.strictObject({checkId:id,kind:z.literal('access'),cases}),z.strictObject({checkId:id,kind:z.literal('recovery')}),
    z.strictObject({checkId:id,kind:z.literal('documentation'),document:z.strictObject({role:z.enum(['user','administrator','operations','architecture']),file:z.string().min(1).max(240).regex(/^[a-zA-Z0-9_./-]+\.md$/).refine(v=>v.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Use a contained Markdown source path'),sections:z.array(z.string().trim().min(1).max(120)).min(1).max(20)})}),
  ])).min(9).max(200),
}).superRefine((q,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  for(const kind of qualityKinds)if(!q.checks.some(c=>c.kind===kind))fail(`Declare a ${kind} quality check`);
  if(new Set(q.checks.map(c=>c.checkId)).size!==q.checks.length)fail('Quality check IDs must be unique');
  if(new Set(q.components.map(c=>c.componentId)).size!==q.components.length||new Set(q.components.map(c=>c.targetKey)).size!==q.components.length)fail('Quality component mappings must be unique');
  const docs=q.checks.filter(c=>c.kind==='documentation');
  for(const role of ['user','administrator','operations','architecture'])if(docs.filter(c=>c.document.role===role).length!==1)fail(`Declare one ${role} handover document`);
  if(new Set(docs.map(c=>c.document.file.toLowerCase())).size!==docs.length)fail('Handover roles require distinct source files');
  const mappings=q.checks.flatMap(c=>'cases' in c?c.cases:[]);
  for(const row of mappings)if(mappings.some(other=>row.testName===other.testName&&row.scenarioId!==other.scenarioId))fail('Distinct scenarios require distinct executable tests');
  for(const c of q.checks)if('cases' in c&&new Set(c.cases.map(r=>`${r.scenarioId}:${r.testName}`)).size!==c.cases.length)fail('Duplicate quality scenario binding');
});
export type QualityContract=z.infer<typeof qualityContractSchema>;
export const qualityDecisionSchema=z.strictObject({checkId:id,evidenceSha256:hash,decision:z.enum(['approved','rejected']),notes:z.string().trim().min(40).max(4000)});
export const qualityResultSchema=z.strictObject({schemaVersion:z.literal(1),contractHash:hash,artifactSha256:hash,evidenceFile:z.literal('quality-evidence.json'),observedAfter:z.iso.datetime(),checks:z.array(z.strictObject({checkId:id,kind:z.enum(qualityKinds),evidenceSha256:hash})).min(9).max(200)});
export const qualityReviewSchema=z.strictObject({reviewer:id,reviewedAt:z.iso.datetime(),evidenceHash:hash,contractHash:hash,decisions:z.array(qualityDecisionSchema).min(9).max(200)});
export const qualityAcceptanceSchema=z.strictObject({reviewer:id,evidenceHash:hash,contractHash:hash,artifactSha256:hash});
