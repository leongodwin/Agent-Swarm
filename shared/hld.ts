/**
 * High-Level Design (HLD) Architecture Types and Generator (Shared)
 */

export interface HldComponent {
  role: string;
  title: string;
  badge: string;
  details: string;
  deliverables: string[];
}

export interface HldInput {
  solutionName: string;
  problemContext: string;
  components: HldComponent[];
  tenantName?: string;
  repoPath?: string;
}

export interface HldResult {
  docId: string;
  generatedAt: number;
  solutionName: string;
  status: 'draft';
  deliveryRecord?: import('./deliveryRecord').RecordReference;
  generationMethod: 'requirements-template' | 'model-synthesis';
  synthesis?: {runtime:'codex-cli'|'claude-sdk';jobId:string;startedAt:number;elapsedMs:number;deadlineMs:300000};
  missingEvidence: string[];
  implementationPlan: {id: string; title: string; deliverables: string[]; acceptance: string[]}[];
  savedFilePath?: string;
  artifactSha256?:string;
  markdownContent: string;
  mermaidDiagrams: {
    topology: string;
    erd: string;
    sequence: string;
  };
}

export { generateHldContent } from './hldDraft';
