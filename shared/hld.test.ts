import { expect, it } from 'vitest';
import { generateHldContent } from './hld';

it('keeps a Canvas-only scope as an unreviewed draft without inventing tables, bots or approval',()=>{
  const result=generateHldContent({solutionName:'Expense solution',problemContext:'Employees submit receipts.',tenantName:'Declared tenant',
    components:[{title:'Expense Canvas app',badge:'Canvas',role:'App maker',details:'Capture reports and receipts.',deliverables:['Expense.msapp']}]});
  expect(result).toMatchObject({status:'draft',generationMethod:'requirements-template'});
  expect(result.markdownContent).toContain('Expense.msapp');expect(result.markdownContent).not.toContain('Approved for Implementation');
  for(const invented of ['cr_incident','CR_WORKORDER','DispatchWorkOrder','Copilot Studio Autonomous Bot','PowerApps-Advisor']) expect(result.markdownContent).not.toContain(invented);
  expect(result.mermaidDiagrams.topology).toContain('Expense Canvas app');expect(result.mermaidDiagrams.erd).toContain('Data model pending');
  expect(result.implementationPlan.find(step=>step.id==='component-1')?.deliverables).toEqual(['Expense.msapp']);
  expect(result.missingEvidence.some(item=>item.includes('environment URL'))).toBe(true);
});

it('identifies missing requirements and creates unique draft IDs without fabricating an architecture',()=>{
  const input={solutionName:'Empty project',problemContext:'Needs discovery',components:[]};
  const first=generateHldContent(input),second=generateHldContent(input);
  expect(first.docId).not.toBe(second.docId);expect(first.missingEvidence).toContain('Component scope and deliverables have not been supplied.');
  expect(first.markdownContent).toContain('No components have been supplied');expect(first.implementationPlan).toHaveLength(3);
});

it('keeps Mermaid labels inside a single declared node and isolates generated plan arrays from input',()=>{
  const component={title:'App"\nclick C0 "https://unsafe.test"<script>\\',badge:'App',role:'Unassigned',details:'Scope',deliverables:[] as string[]};
  const input={solutionName:'Title"\nclassDef bad fill:red',problemContext:'Test',components:[component]};
  const result=generateHldContent(input);expect(result.mermaidDiagrams.topology.split('\n')).toHaveLength(4);
  expect(result.mermaidDiagrams.topology).not.toContain('<script>');
  expect(result.mermaidDiagrams.topology).not.toContain('\\');
  result.implementationPlan[1].deliverables.push('Added after generation');expect(component.deliverables).toEqual([]);
  expect(result.markdownContent).toContain('Not supplied.');
});
