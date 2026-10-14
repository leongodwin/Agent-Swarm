export interface HealthEvidenceView {
  status:'clear'|'blocked'|'unavailable';
  checkedAt:string;
  reasons:string[];
  files:{file:string;kind:'decision'|'package'|'schema'|'advanced-policy'}[];
}
