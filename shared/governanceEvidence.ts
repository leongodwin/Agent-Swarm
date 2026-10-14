export const deliveryGovernancePhases=['build','test','import','post-deploy','verify','health'] as const;
export interface GovernanceEvidenceView {
  scope:'historical-governance-decisions';
  stages:{phase:typeof deliveryGovernancePhases[number];status:'clear'|'blocked'|'unavailable'|'not-recorded'|'evidence-unavailable';file?:string;checkedAt?:string;reasons:string[];artifactSha256?:string;settingsSha256?:string}[];
}
