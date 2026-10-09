import { AlmPipeline, INITIAL_ALM_PIPELINE } from '../shared/alm.ts';
import { getActiveEnvironment } from './tenancy.ts';

type NotificationFn = (cardInput: { title: string; subtitle?: string; summary?: string; facts?: { title: string; value: string }[] }) => void;

class AlmPipelineManager {
  private pipeline: AlmPipeline = JSON.parse(JSON.stringify(INITIAL_ALM_PIPELINE));
  private notifier?: NotificationFn;

  setNotifier(fn: NotificationFn) {
    this.notifier = fn;
  }

  getPipeline(): AlmPipeline {
    // Dynamically align active environment from live tenancy
    try {
      const active = getActiveEnvironment();
      if (active.environmentUrl) {
        this.pipeline.environments.prod.url = active.environmentUrl;
        this.pipeline.environments.prod.name = active.environmentName;
        this.pipeline.environments.dev.url = active.environmentUrl;
        this.pipeline.environments.test.url = active.environmentUrl;
      }
    } catch {
      // Keep pipeline defaults
    }
    return this.pipeline;
  }

  approveRelease(approver: string = 'Leon van Zyl'): AlmPipeline {
    const active = getActiveEnvironment();
    const oldVersion = this.pipeline.currentProdVersion;
    const newVersion = this.pipeline.targetVersion;

    this.pipeline.approvalStatus = 'deployed';
    this.pipeline.approvedBy = approver;
    this.pipeline.approvedAt = new Date().toISOString();
    this.pipeline.currentProdVersion = newVersion;

    // Update Prod Environment with real environment URL
    this.pipeline.environments.prod = {
      id: 'prod',
      name: `${active.environmentName} (${active.tenantDomain})`,
      url: active.environmentUrl,
      version: newVersion,
      lastDeployedAt: 'Just now by ' + approver,
      buildStatus: 'clean',
      unpackedCommitSha: this.pipeline.environments.test.unpackedCommitSha,
      checks: [
        {
          id: 'prod-release-gate',
          name: 'Manager Signoff & Enterprise ALM Release Gate',
          category: 'automated_tests',
          status: 'passed',
          details: `Promoted from UAT to Production by ${approver}. Managed zip deployed successfully.`,
          metric: `v${newVersion} LIVE`,
        },
        ...this.pipeline.environments.prod.checks,
      ],
    };

    // Increment target version for next release cycle
    const parts = newVersion.split('.').map(Number);
    if (parts.length === 4) {
      parts[3] += 1;
      this.pipeline.targetVersion = parts.join('.');
      this.pipeline.managedPackageName = `ContosoCustomerServiceCopilot_${parts.join('_')}_managed.zip`;
    }

    // Broadcast Adaptive Card announcement to Teams
    try {
      this.notifier?.({
        title: `🚀 Production Release Deployed: v${newVersion}`,
        subtitle: 'Application Lifecycle Management (ALM)',
        summary: `Solution '${this.pipeline.solutionFriendlyName}' successfully promoted from UAT to Production by ${approver}. Previous version was v${oldVersion}.`,
        facts: [
          { title: 'Solution', value: this.pipeline.solutionUniqueName },
          { title: 'New Version', value: `v${newVersion}` },
          { title: 'Approver', value: approver },
          { title: 'Environment', value: `${active.environmentName} (${active.environmentUrl})` },
        ],
      });
    } catch {
      // Ignore if broadcast unavailable
    }

    return this.pipeline;
  }

  rollbackRelease(): AlmPipeline {
    this.pipeline = JSON.parse(JSON.stringify(INITIAL_ALM_PIPELINE));
    this.pipeline.approvalStatus = 'pending_manager_approval';
    return this.pipeline;
  }
}

export const almManager = new AlmPipelineManager();
