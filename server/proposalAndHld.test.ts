import { describe, expect, it } from 'vitest';
import { generateProposal } from './proposalAgent';
import { generateHld } from './hldAgent';

describe('Proposal scenario', () => {
  it('keeps pricing, savings and schedule unknown without explicit commercial inputs', () => {
    const result=generateProposal({title:'Expense solution',clientName:'Client',industry:'Services',problemStatement:'Receipt capture',userCount:1,monthlyTransactions:1,complianceTier:'financial',targetChannels:[],integrationPoints:[]});
    expect(result).toMatchObject({status:'draft',totalMonthlyLicenseCost:null,annualLicenseCost:null,implementationCostEstimate:null,projectedAnnualSavings:null,threeYearRoiPercent:null,estimatedTimelineWeeks:null});
    expect(result.licensingBOM).toEqual([]);expect(result.sprintRoadmap.every(item=>item.weeks==='Unscheduled')).toBe(true);
    expect(result.markdownContent).toContain('Users supplied: 1');expect(result.markdownContent).not.toContain('Copilot Studio Message Pack');
  });
  it('does not infer security SKUs or certification from the compliance review category', () => {
    const result=generateProposal({title:'App',clientName:'Client',industry:'Finance',problemStatement:'Requirements',userCount:100,monthlyTransactions:10000,complianceTier:'hipaa',targetChannels:['Teams'],integrationPoints:['Dataverse']});
    expect(result.licensingBOM).toEqual([]);expect(result.markdownContent).toContain('not certification');expect(result.markdownContent).not.toContain('Microsoft Entra ID P2');
  });
});

describe('High-Level Design (HLD) Document Generator Agent', () => {
  it('generates a declared-scope draft with unresolved schema and workflow evidence', async () => {
    const res = await generateHld({
      solutionName: 'Contoso Claims Fusion Accelerator',
      problemContext: 'Automating multi-point claim inspection.',
      components: [
        {
          role: 'Copilot Architect',
          title: 'Field Inspection Topic',
          badge: 'COPILOT STUDIO',
          details: 'Voice & text conversational workflows',
          deliverables: ['Topics/Inspection.yaml'],
        },
        {
          role: 'Data Modeler',
          title: 'Incident Table Schema',
          badge: 'DATAVERSE',
          details: 'Relational tables with audit logging',
          deliverables: ['cr_incident.xml'],
        },
      ],
      tenantName: 'contoso.onmicrosoft.com',
    });

    expect(res.docId).toMatch(/^HLD-/);
    expect(res.solutionName).toBe('Contoso Claims Fusion Accelerator');

    expect(res).toMatchObject({status:'draft',generationMethod:'requirements-template'});
    expect(res.mermaidDiagrams.topology).toContain('Field Inspection Topic');
    expect(res.mermaidDiagrams.topology).toContain('Incident Table Schema');
    expect(res.mermaidDiagrams.erd).toContain('Data model pending');
    expect(res.mermaidDiagrams.sequence).toContain('Workflow pending');
    expect(res.markdownContent).toContain('Topics/Inspection.yaml');
    expect(res.markdownContent).toContain('Implementation plan — review required');
    expect(res.markdownContent).not.toContain('Approved for Implementation');
  });
});
