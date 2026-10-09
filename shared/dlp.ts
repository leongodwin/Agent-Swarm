/**
 * Local source-code DLP heuristic for selected connectors and anonymous authentication.
 * Supports a merge gate; it does not query or certify actual tenant DLP policies.
 */

export type ConnectorCategory = 'Business' | 'Non-Business' | 'Blocked';

export interface DlpPolicyRule {
  id: string;
  name: string;
  category: ConnectorCategory;
  pattern: RegExp;
  description: string;
}

export interface DlpPolicyViolation {
  id: string;
  connectorName: string;
  category: ConnectorCategory;
  resourceFile: string;
  lineSnippet?: string;
  severity: 'Critical' | 'High' | 'Medium';
  remediation: string;
}

export const ENTERPRISE_DLP_RULES: DlpPolicyRule[] = [
  // Blocked Exfiltration & Consumer Storage
  {
    id: 'dropbox',
    name: 'Dropbox Consumer Storage',
    category: 'Blocked',
    pattern: /dropbox\.com|shared_dropbox/i,
    description: 'Direct integration with Dropbox consumer accounts is strictly blocked by enterprise policy.',
  },
  {
    id: 'googledrive',
    name: 'Google Drive Personal Storage',
    category: 'Blocked',
    pattern: /googledrive|drive\.google\.com/i,
    description: 'Personal Google Drive storage is forbidden in enterprise tenant solutions.',
  },
  {
    id: 'twitter',
    name: 'X (Twitter) Social Connector',
    category: 'Blocked',
    pattern: /twitter\.com|shared_twitter/i,
    description: 'Social media connectors are barred from accessing enterprise Dataverse records.',
  },
  {
    id: 'anon_http',
    name: 'Anonymous / Unauthenticated HTTP Webhook',
    category: 'Blocked',
    pattern: /"authentication":\s*\{\s*"type":\s*"None"|"anonymous":\s*true/i,
    description: 'Unauthenticated outbound HTTP calls without Entra ID token auth violate zero-trust policy.',
  },
  // Non-Business Connectors (Barred from co-mingling with Business data)
  {
    id: 'trello',
    name: 'Trello Consumer Board',
    category: 'Non-Business',
    pattern: /trello\.com|shared_trello/i,
    description: 'Trello connector is classified Non-Business and cannot co-mingle with Dataverse data.',
  },
  {
    id: 'slack',
    name: 'External Slack Workspace',
    category: 'Non-Business',
    pattern: /slack\.com|shared_slack/i,
    description: 'External Slack webhooks cannot receive confidential enterprise customer records.',
  },
];

export const ALLOWED_BUSINESS_CONNECTORS = [
  { name: 'Microsoft Dataverse', icon: '💾', auth: 'Managed Identity / SSO', tier: 'Business' },
  { name: 'Azure OpenAI Service', icon: '🤖', auth: 'Private VNet / Entra ID', tier: 'Business' },
  { name: 'Office 365 Users & Outlook', icon: '✉️', auth: 'OAuth 2.0 Graph API', tier: 'Business' },
  { name: 'Microsoft Teams Webhook v3', icon: '💬', auth: 'Adaptive Card Token', tier: 'Business' },
  { name: 'SharePoint Online Document Store', icon: '📄', auth: 'O365 Enterprise', tier: 'Business' },
  { name: 'Azure SQL Hyperscale', icon: '🗄️', auth: 'Entra Service Principal', tier: 'Business' },
];

/**
 * Scans flow JSON definitions or topic YAML for DLP rule violations.
 */
export function auditDlpCompliance(fileContent: string, resourcePath = 'solution_artifact'): DlpPolicyViolation[] {
  const violations: DlpPolicyViolation[] = [];
  let anonymous = false;
  try {
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const authentication = record.authentication;
      if (record.anonymous === true || (authentication && typeof authentication === 'object' &&
        String((authentication as Record<string, unknown>).type).toLowerCase() === 'none')) anonymous = true;
      for (const child of Object.values(record)) walk(child);
    };
    walk(JSON.parse(fileContent));
  } catch {
    // Non-JSON artifacts use documented text heuristics, not a tenant policy evaluation.
    anonymous = /authentication:\s*\r?\n\s+type:\s*['"]?none\b|anonymous:\s*true\b/i.test(fileContent);
  }

  for (const rule of ENTERPRISE_DLP_RULES) {
    if (rule.pattern.test(fileContent) || (rule.id === 'anon_http' && anonymous)) {
      violations.push({
        id: `dlp-${rule.id}-${Date.now()}`,
        connectorName: rule.name,
        category: rule.category,
        resourceFile: resourcePath,
        severity: rule.category === 'Blocked' ? 'Critical' : 'High',
        remediation: `Remove or replace '${rule.name}' with approved Business connectors (Microsoft Dataverse, Azure OpenAI, or Teams).`,
      });
    }
  }

  return violations;
}

export const dlpResource = (file: string) => /\.(json|ya?ml|xml|botproj|[cm]?js|tsx?)$/i.test(file);

/**
 * Parse unified diff text into an array of modified files with their newly added lines.
 */
export function parseDiffFiles(diffText: string): { file: string; addedContent: string }[] {
  if (!diffText || typeof diffText !== 'string') return [];
  const files: { file: string; addedContent: string }[] = [];
  const chunks = diffText.split(/^diff --git /m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const headerMatch = chunk.match(/^(?:---|\+\+\+)\s+[ab]\/(.*?)(?:\r?\n|$)/m) ?? chunk.match(/b\/([^\s\r\n]+)/);
    const fileName = headerMatch ? headerMatch[1].trim() : 'unknown';
    const addedLines = chunk
      .split(/\r?\n/)
      .filter((l) => (l.startsWith('+') && !l.startsWith('+++')) || l.startsWith(' '))
      .map((l) => l.slice(1))
      .join('\n');
    files.push({ file: fileName, addedContent: addedLines });
  }
  return files;
}

/**
 * Scans a PR diff for DLP policy violations across solution workflows, topics, and configs.
 */
export function auditPrDiff(diffText: string): DlpPolicyViolation[] {
  const files = parseDiffFiles(diffText);
  const violations: DlpPolicyViolation[] = [];
  for (const f of files) {
    const lower = f.file.toLowerCase();
    // Exclude documentation and non-solution asset files
    if (!dlpResource(lower)) {
      continue;
    }
    const found = auditDlpCompliance(f.addedContent, f.file);
    violations.push(...found);
  }
  return violations;
}

