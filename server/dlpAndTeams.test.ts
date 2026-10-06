import { describe, expect, it } from 'vitest';
import { auditDlpCompliance, auditPrDiff, ENTERPRISE_DLP_RULES, parseDiffFiles } from '../shared/dlp.ts';
import { buildTeamsCard, formatAdaptiveCardJson } from '../shared/teams.ts';
import { mergeStep, type MergePull, type MergeRecord } from './mergeGate.ts';

const pull = (p: Partial<MergePull> = {}): MergePull => ({
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeState: 'CLEAN',
  headSha: 'abc123',
  checks: 'passing',
  failedChecks: [],
  pendingChecks: [],
  ...p,
});

const record = (r: Partial<MergeRecord> = {}): MergeRecord => ({
  passedSha: 'abc123',
  mergeFixes: 0,
  pendingSince: null,
  mergeRetryAt: null,
  alerted: false,
  ...r,
});

describe('DLP Governance Policy & PR Merge Gate', () => {
  it('detects prohibited Dropbox consumer storage and anonymous webhook endpoints', () => {
    expect(ENTERPRISE_DLP_RULES.length).toBeGreaterThan(0);
    const compliantFlow = JSON.stringify({
      name: 'CompliantFlow',
      actions: {
        DataverseAction: { host: { connectionName: 'shared_commondataserviceforapps' } },
        TeamsAction: { host: { connectionName: 'shared_teams' } },
      },
    });
    const compliantViolations = auditDlpCompliance(compliantFlow, 'Workflows/Compliant.json');
    expect(compliantViolations.length).toBe(0);

    const nonCompliantFlow = JSON.stringify({
      name: 'LeakyFlow',
      actions: {
        Exfiltrate: { host: { connectionName: 'shared_dropbox' } },
        AnonymousApi: { authentication: { type: 'None' } },
      },
    });
    const violations = auditDlpCompliance(nonCompliantFlow, 'Workflows/Leaky.json');
    expect(violations.length).toBe(2);
    expect(violations[0].connectorName).toBe('Dropbox Consumer Storage');
    expect(violations[0].severity).toBe('Critical');
    expect(violations[1].connectorName).toBe('Anonymous / Unauthenticated HTTP Webhook');
  });

  it('rejects PR and sends it back to developer agent when DLP violations exist', () => {
    const base = { base: 'main' };
    const cleanStep = mergeStep(pull(), record(), Date.now(), base);
    expect(cleanStep.do).toBe('merge');

    const violations = auditDlpCompliance('{"host": {"connectionName": "shared_dropbox"}}', 'flow.json');
    const dlpPull = pull({ dlpViolations: violations });
    const blockedStep = mergeStep(dlpPull, record(), Date.now(), base);

    expect(blockedStep.do).toBe('send-back');
    if (blockedStep.do === 'send-back') {
      expect(blockedStep.reason).toBe('dlp');
      expect(blockedStep.instructions).toContain('Dropbox Consumer Storage');
      expect(blockedStep.needsHuman).toBe(false);
    }
  });

  it('parses git diffs and audits added lines in solution files for DLP violations', () => {
    const sampleDiff = `
diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # Documentation
+Do not use dropbox.com in production.

diff --git a/Workflows/SyncOrder.json b/Workflows/SyncOrder.json
index 3333333..4444444 100644
--- a/Workflows/SyncOrder.json
+++ b/Workflows/SyncOrder.json
@@ -10,3 +10,6 @@
+  "connection": {
+    "type": "shared_dropbox"
+  }
`;

    const parsed = parseDiffFiles(sampleDiff);
    expect(parsed.length).toBe(2);
    expect(parsed[0].file).toBe('README.md');
    expect(parsed[1].file).toBe('Workflows/SyncOrder.json');

    const violations = auditPrDiff(sampleDiff);
    // README.md is ignored by DLP audit; only solution artifact is flagged
    expect(violations.length).toBe(1);
    expect(violations[0].resourceFile).toBe('Workflows/SyncOrder.json');
    expect(violations[0].connectorName).toBe('Dropbox Consumer Storage');
    expect(violations[0].category).toBe('Blocked');
  });

  it('scans a solution checkout directory for DLP compliance', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { scanDirectoryDlp } = await import('./dlpScanner.ts');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-test-'));
    try {
      const workflowsDir = path.join(tmpDir, 'Workflows');
      fs.mkdirSync(workflowsDir, { recursive: true });

      fs.writeFileSync(
        path.join(workflowsDir, 'SafeFlow.json'),
        JSON.stringify({ host: { connectionName: 'shared_commondataserviceforapps' } }),
      );
      fs.writeFileSync(
        path.join(workflowsDir, 'UnsafeFlow.json'),
        JSON.stringify({ host: { connectionName: 'shared_trello' } }),
      );

      const report = scanDirectoryDlp(tmpDir, 'test/org-solution');
      expect(report.scannedFiles).toBe(2);
      expect(report.isRealScan).toBe(true);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0].connectorName).toBe('Trello Consumer Board');
      expect(report.violations[0].category).toBe('Non-Business');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Microsoft Teams Adaptive Card Generator', () => {
  it('builds valid Teams Adaptive Card 1.5 JSON payload', () => {
    const card = buildTeamsCard({
      title: 'Incident Resolved',
      subtitle: 'Copilot Studio Triage Agent',
      summary: 'Automated claim review finished with zero errors.',
      facts: [
        { title: 'Claim ID', value: 'CLM-9092' },
        { title: 'Status', value: 'Approved' },
      ],
      actionUrl: 'http://localhost:4455/office',
    });

    expect(card.id).toMatch(/^teams-msg-/);
    expect(card.title).toBe('Incident Resolved');
    expect(card.facts.length).toBe(2);

    const json = formatAdaptiveCardJson(card);
    expect(json.type).toBe('message');
    const attachments = json.attachments as Array<{ content: { type: string; version: string; body: unknown[]; actions: unknown[] } }>;
    expect(attachments[0].content.type).toBe('AdaptiveCard');
    expect(attachments[0].content.version).toBe('1.5');
    expect(attachments[0].content.actions.length).toBe(1);
  });
});
