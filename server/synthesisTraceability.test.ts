import {expect,it} from 'vitest';
import {synthesisOutputSchema} from '../shared/hldSynthesis.ts';
import {synthesisRequirements,requireSynthesisTraceability} from './synthesisTraceability.ts';
const input={solutionName:'Expenses',problemContext:'Capture expenses with every receipt.',tenantName:'Declared development target; not verified',components:[{title:'Canvas',role:'Maker',badge:'Canvas',details:'GBP expenses',deliverables:['Expense.msapp','Runbook']}]};
const text='Synthetic design and acceptance text for structural traceability only.';
function fixture(){const catalogue=synthesisRequirements(input);const design=synthesisOutputSchema.parse({summary:text,architecture:text,dataModel:text,securityAndGovernance:text,operationsAndRecovery:text,decisions:[{decision:text,rationale:text,alternatives:text}],risks:[{risk:text,mitigation:text}],requirements:catalogue.map(source=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['build'],requirement:text,design:text,acceptance:text})),implementationPlan:['build','test','deploy'].map(id=>({id,title:id,deliverables:['Synthetic artifact'],acceptance:[text]})),missingEvidence:['Independent QA and tenant acceptance remain missing.'],mermaidDiagrams:{topology:'flowchart LR\nA-->B',erd:'erDiagram\nA ||--o{ B : contains',sequence:'sequenceDiagram\nA->>B: submit'}});return {catalogue,design};}
it('binds each source and preserves distinct equal-text deliverables by their component position',()=>{
  const {catalogue,design}=fixture();expect(catalogue.map(row=>row.id)).toEqual(['brief','tenant-context','component-1','component-1-deliverable-1','component-1-deliverable-2']);expect(()=>requireSynthesisTraceability(catalogue,design)).not.toThrow();
  const changed=synthesisRequirements({...input,components:[{...input.components[0],deliverables:['Expense.msapp','Changed runbook']}]});expect(changed[4].sourceSha256).not.toBe(catalogue[4].sourceSha256);expect(()=>requireSynthesisTraceability(changed,design)).toThrow('source differs');
});
it.each(['missing','duplicate','unknown','digest','plan-link','duplicate-link','duplicate-step','empty-plan'] as const)('rejects structural coverage failure: %s',mode=>{
  const {catalogue,design}=fixture();if(mode==='missing')design.requirements.pop();if(mode==='duplicate')design.requirements[1]={...design.requirements[0]};if(mode==='unknown')design.requirements[0].requirementId='invented';if(mode==='digest')design.requirements[0].sourceSha256='a'.repeat(64);if(mode==='plan-link')design.requirements[0].planStepIds=['invented'];if(mode==='duplicate-link')design.requirements[0].planStepIds=['build','build'];if(mode==='duplicate-step')design.implementationPlan[1].id='build';if(mode==='empty-plan')design.implementationPlan[0].acceptance=[];
  expect(()=>requireSynthesisTraceability(catalogue,design)).toThrow();
});
it('bounds the catalogue before runtime admission',()=>{
  expect(()=>synthesisRequirements({...input,components:Array.from({length:10},()=>({...input.components[0],deliverables:Array.from({length:100},()=> 'Repeated deliverable')}))})).toThrow('1,000');
});
