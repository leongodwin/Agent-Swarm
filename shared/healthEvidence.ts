export interface SchemaDiagnostic {
  stage:'contract'|'initial-identity'|'resource-contracts'|'migration'|'columns'|'structure'|'final-identity'|'evidence'|'complete';
  failure:'none'|'validation'|'provider'|'cancelled'|'limit';
  elapsedMs:number;nativeCommands:number;metadataReads:number;responseBytes:number;
}
export interface HealthEvidenceView {
  status:'clear'|'blocked'|'unavailable';
  checkedAt:string;
  reasons:string[];
  files:{file:string;kind:'decision'|'package'|'schema'|'advanced-policy'}[];
  schema?:{status:'observed'|'unavailable';checkedAt:string;reason:string;diagnostic?:SchemaDiagnostic}|{status:'evidence-unavailable'};
}
