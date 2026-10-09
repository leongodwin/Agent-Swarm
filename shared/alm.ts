/**
 * Application Lifecycle Management (ALM) Multi-Environment Pipeline Models.
 * Powers the Dev -> Test -> Prod deployment gates and 3D Release Approval Station.
 */

export type AlmEnvironmentId = 'dev' | 'test' | 'prod';

export interface AlmGateCheck {
  id: string;
  name: string;
  category: 'pac_cli' | 'automated_tests' | 'dlp_security' | 'entra_identity' | 'solution_checker';
  status: 'passed' | 'failed' | 'warning' | 'pending';
  details: string;
  metric?: string;
}

export interface AlmEnvironmentStatus {
  id: AlmEnvironmentId;
  name: string;
  url: string;
  version: string;
  lastDeployedAt: string;
  buildStatus: 'clean' | 'building' | 'deploying' | 'failed';
  unpackedCommitSha: string;
  checks: AlmGateCheck[];
}

export type AlmApprovalStatus = 'pending_manager_approval' | 'deploying' | 'deployed' | 'rejected';

export interface AlmPipeline {
  simulated?: boolean;
  solutionUniqueName: string;
  solutionFriendlyName: string;
  targetVersion: string;
  currentProdVersion: string;
  managedPackageName: string;
  approvalStatus: AlmApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  environments: Record<AlmEnvironmentId, AlmEnvironmentStatus>;
  releaseNotes: string[];
  workflowYaml: string;
}

export const INITIAL_ALM_PIPELINE: AlmPipeline = {
  solutionUniqueName: 'ContosoCustomerServiceCopilot',
  solutionFriendlyName: 'Contoso Enterprise Service Copilot & Power Automate Core',
  targetVersion: '1.3.0.4',
  currentProdVersion: '1.2.9.1',
  managedPackageName: 'ContosoCustomerServiceCopilot_1_3_0_4_managed.zip',
  approvalStatus: 'pending_manager_approval',
  approvedBy: undefined,
  approvedAt: undefined,
  environments: {
    dev: {
      id: 'dev',
      name: 'Development Sandbox',
      url: 'https://contoso-dev.crm.dynamics.com',
      version: '1.3.0.4',
      lastDeployedAt: 'Today at 14:15 GMT',
      buildStatus: 'clean',
      unpackedCommitSha: '7f9c2d1',
      checks: [
        {
          id: 'dev-pac-unpack',
          name: 'PAC Solution Unpack & Git Sync',
          category: 'pac_cli',
          status: 'passed',
          details: 'Extracted 14 Topics, 6 Flows, 4 Custom Entities, 2 PCF Controls',
          metric: '100% Synced',
        },
        {
          id: 'dev-static-analysis',
          name: 'Power Platform Solution Checker',
          category: 'solution_checker',
          status: 'passed',
          details: '0 High Severity violations; 2 low severity informational hints resolved',
          metric: '0 High Errors',
        },
      ],
    },
    test: {
      id: 'test',
      name: 'UAT & Automated Validation Environment',
      url: 'https://contoso-test.crm.dynamics.com',
      version: '1.3.0.4',
      lastDeployedAt: 'Today at 14:48 GMT',
      buildStatus: 'clean',
      unpackedCommitSha: '7f9c2d1',
      checks: [
        {
          id: 'test-intent-matrix',
          name: 'Copilot Studio Intent Regression Matrix',
          category: 'automated_tests',
          status: 'passed',
          details: '24 conversational test scenarios executed via Direct Line harness',
          metric: '98.4% Accuracy',
        },
        {
          id: 'test-flow-integration',
          name: 'Power Automate End-to-End Flow Telemetry',
          category: 'automated_tests',
          status: 'passed',
          details: '5 cloud flows triggered against mocked Dataverse mock instances',
          metric: '5/5 Passed (210ms avg)',
        },
        {
          id: 'test-dlp-audit',
          name: 'Tenant DLP Guardrail Zero-Trust Scan',
          category: 'dlp_security',
          status: 'passed',
          details: 'Zero prohibited consumer connectors or anonymous HTTP endpoints',
          metric: '100% Compliant',
        },
        {
          id: 'test-entra-spn',
          name: 'Microsoft Entra ID App Registration & Managed Identity',
          category: 'entra_identity',
          status: 'passed',
          details: 'Principal ID 8d49b-77fa verified with Dynamics CRM organization read/write scopes',
          metric: 'Token Validated',
        },
      ],
    },
    prod: {
      id: 'prod',
      name: 'Production Enterprise Cluster',
      url: 'https://contoso.crm.dynamics.com',
      version: '1.2.9.1',
      lastDeployedAt: 'Yesterday at 17:00 GMT',
      buildStatus: 'clean',
      unpackedCommitSha: '3a880e4',
      checks: [
        {
          id: 'prod-sla',
          name: 'Production Health & SLA Uptime',
          category: 'automated_tests',
          status: 'passed',
          details: 'Zero reported runtime exceptions in the last 24 hours',
          metric: '99.98% Uptime',
        },
      ],
    },
  },
  releaseNotes: [
    '✨ Integrated Copilot Studio Intent Handler for Priority SLA queries (`CAS-10492-X9`).',
    '⚡ Added Power Automate Instant Cloud Flow for Manager Approval escalation with Adaptive Card dispatch.',
    '💾 Deployed Dataverse table schema updates for `cr_ticket_escalation` with column-level security.',
    '🛡️ Verified Zero-Trust DLP policy conformance across all cloud flows and connectors.',
    '📦 Packaged into Managed Solution `ContosoCustomerServiceCopilot_1_3_0_4_managed.zip` via PAC CLI.',
  ],
  workflowYaml: `name: Power Platform ALM - Deploy Managed Solution to Production
on:
  workflow_dispatch:
    inputs:
      solution_version:
        description: 'Version to ship to Production'
        required: true
        default: '1.3.0.4'
      manager_approver:
        description: 'Authorized Manager Signoff'
        required: true
        default: 'Leon van Zyl'

jobs:
  production-release:
    runs-on: windows-latest
    environment: Production
    steps:
      - name: Checkout Source Control
        uses: actions/checkout@v4

      - name: Install Power Platform Tools (PAC CLI)
        uses: microsoft/powerplatform-actions/actions-install@v1

      - name: Pack Managed Solution
        uses: microsoft/powerplatform-actions/pack-solution@v1
        with:
          solution-file: out/ContosoCustomerServiceCopilot_managed.zip
          solution-folder: src/solutions/ContosoCustomerServiceCopilot
          solution-type: 'Managed'

      - name: Import Solution to Production
        uses: microsoft/powerplatform-actions/import-solution@v1
        with:
          environment-url: \${{ secrets.POWER_PLATFORM_PROD_URL }}
          app-id: \${{ secrets.AZURE_CLIENT_ID }}
          client-secret: \${{ secrets.AZURE_CLIENT_SECRET }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          solution-file: out/ContosoCustomerServiceCopilot_managed.zip
          force-overwrite: true
          publish-changes: true

      - name: Post Adaptive Card Announcement to Microsoft Teams
        uses: chf/action-teams-notification@v1
        with:
          webhook-url: \${{ secrets.TEAMS_INCOMING_WEBHOOK_URL }}
          title: "🚀 Production Deployment Completed: ContosoCustomerServiceCopilot v\${{ inputs.solution_version }}"
          message: "Signed off by \${{ inputs.manager_approver }}. Solution is now live for all global enterprise users."
`,
};
