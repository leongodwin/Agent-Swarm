export interface SolutionComponentNode {
  id: string;
  category: '1. Engagement Channel' | '2. Copilot Studio' | '3. Automation & Logic' | '4. Dataverse & Storage' | string;
  name: string;
  badge: string;
  badgeBg: string;
  summary: string;
  techStack: string[];
  telemetry: {
    invocations: string;
    avgLatency: string;
    successRate: string;
  };
  details: string;
  sourceFile?: string;
}

export interface ParsedSolution {
  solutionName: string;
  isUnpacked: boolean;
  totalComponents: number;
  components: Record<string, SolutionComponentNode>;
}
