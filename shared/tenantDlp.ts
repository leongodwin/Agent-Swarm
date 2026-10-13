export interface TenantDlpView {
  status: 'unavailable' | 'reading' | 'observed' | 'stale';
  tenantId?: string;
  caller?: string;
  observedAt?: string;
  policyCount?: number;
  fingerprint?: string;
  reason?: string;
  readerPid?: number;
  scope: 'standard-policy-inventory';
  complianceVerified: false;
}
