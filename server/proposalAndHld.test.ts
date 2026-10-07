import { describe, expect, it } from 'vitest';
import { generateProposal } from './proposalAgent';
import { generateHld } from './hldAgent';

describe('Proposal Generator Agent', () => {
  it('calculates comprehensive licensing BOM, ROI, and SOW roadmap', () => {
    const res = generateProposal({
      title: 'Contoso Asset Inspection Automation',
      clientName: 'Contoso Logistics Ltd',
      industry: 'Logistics',
      problemStatement: 'Manual paper forms delay repair billing by 48 hours.',
      userCount: 500,
      monthlyTransactions: 50000,
      complianceTier: 'standard',
      targetChannels: ['Teams', 'Webchat'],
      integrationPoints: ['Dataverse', 'SAP ERP'],
    });

    expect(res.proposalId).toMatch(/^PROP-/);
    expect(res.totalMonthlyLicenseCost).toBeGreaterThan(0);
    expect(res.annualLicenseCost).toBe(res.totalMonthlyLicenseCost * 12);
    expect(res.threeYearRoiPercent).toBeGreaterThan(100);
    expect(res.sprintRoadmap.length).toBe(6);

    // Verify SKUs
    const skus = res.licensingBOM.map((b) => b.sku);
    expect(skus).toContain('Copilot Studio Message Pack');
    expect(skus).toContain('Power Apps Per User Plan');
    expect(skus).toContain('Dataverse Database Capacity (GB)');
    expect(skus).toContain('Microsoft Entra ID P1');

    // Verify Markdown SOW
    expect(res.markdownContent).toContain('Commercial Proposal & Solution Scope');
    expect(res.markdownContent).toContain('Contoso Logistics Ltd');
    expect(res.markdownContent).toContain('Sprint 1: Foundation');
  });

  it('adjusts security pricing for financial compliance tier', () => {
    const std = generateProposal({
      title: 'App',
      clientName: 'Client',
      industry: 'General',
      problemStatement: 'Problem',
      userCount: 100,
      monthlyTransactions: 10000,
      complianceTier: 'standard',
      targetChannels: ['Teams'],
      integrationPoints: ['Dataverse'],
    });

    const fin = generateProposal({
      title: 'App',
      clientName: 'Client',
      industry: 'Finance',
      problemStatement: 'Problem',
      userCount: 100,
      monthlyTransactions: 10000,
      complianceTier: 'financial',
      targetChannels: ['Teams'],
      integrationPoints: ['Dataverse'],
    });

    const stdEntra = std.licensingBOM.find((b) => b.category === 'Security & Entra')!;
    const finEntra = fin.licensingBOM.find((b) => b.category === 'Security & Entra')!;
    expect(finEntra.unitPriceMonthly).toBeGreaterThan(stdEntra.unitPriceMonthly);
  });
});

describe('High-Level Design (HLD) Document Generator Agent', () => {
  it('generates Well-Architected Framework HLD and Mermaid schematics', () => {
    const res = generateHld({
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

    // Verify Mermaid diagrams
    expect(res.mermaidDiagrams.topology).toContain('graph TB');
    expect(res.mermaidDiagrams.topology).toContain('Copilot Studio Autonomous Bot');
    expect(res.mermaidDiagrams.erd).toContain('erDiagram');
    expect(res.mermaidDiagrams.erd).toContain('CR_INCIDENT');
    expect(res.mermaidDiagrams.sequence).toContain('sequenceDiagram');
    expect(res.mermaidDiagrams.sequence).toContain('Copilot Studio');

    // Verify Well-Architected sections
    expect(res.markdownContent).toContain('Executive Architecture Overview');
    expect(res.markdownContent).toContain('Logical Component Architecture');
    expect(res.markdownContent).toContain('Data Architecture & Dataverse Entity Model (ERD)');
    expect(res.markdownContent).toContain('Security, Identity & Data Loss Prevention (DLP)');
    expect(res.markdownContent).toContain('Application Lifecycle Management (ALM)');
  });
});
