export interface ToolGovernanceEntry {
  id: string; at: string; actor: string; runtime: string;
  source: 'sdk-hook' | 'sdk-permission' | 'cli-hook'; tool: string;
  inputSha256: string; ruleVersion: string; copilotPaused: boolean;
  status: 'allowed' | 'blocked' | 'unavailable'; reason: string;
}
export interface ToolGovernanceView {
  schemaVersion: 1; evaluated: number; blocked: number; unavailable: number;
  recent: ToolGovernanceEntry[]; scope: 'request-local-safeguards';
  unavailableReason: string | null; tenantPolicyVerified: false; note: string;
}
