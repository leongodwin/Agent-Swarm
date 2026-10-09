import { beforeEach, describe, expect, it } from 'vitest';
import { AlmPipelineManager } from './almGate.ts';
import { INITIAL_ALM_PIPELINE } from '../shared/alm.ts';

describe('Application Lifecycle Management (ALM) Multi-Environment Pipeline', () => {
  let almManager: AlmPipelineManager;
  beforeEach(() => {
    almManager = new AlmPipelineManager();
  });

  it('loads initial pipeline state with complete multi-stage checks and gates', () => {
    const pipeline = almManager.getPipeline();
    expect(pipeline.solutionUniqueName).toBe('ContosoCustomerServiceCopilot');
    expect(pipeline.approvalStatus).toBe('pending_manager_approval');
    expect(pipeline.targetVersion).toBe('1.3.0.4');
    expect(pipeline.currentProdVersion).toBe('1.2.9.1');

    // Environments presence
    expect(pipeline.environments.dev).toBeDefined();
    expect(pipeline.environments.test).toBeDefined();
    expect(pipeline.environments.prod).toBeDefined();

    // Dev checks
    const devChecks = pipeline.environments.dev.checks;
    expect(devChecks.some((c) => c.category === 'pac_cli')).toBe(true);
    expect(devChecks.some((c) => c.category === 'solution_checker')).toBe(true);

    // Test checks
    const testChecks = pipeline.environments.test.checks;
    expect(testChecks.some((c) => c.category === 'automated_tests')).toBe(true);
    expect(testChecks.some((c) => c.category === 'dlp_security')).toBe(true);
    expect(testChecks.some((c) => c.category === 'entra_identity')).toBe(true);

    // Release notes & YAML workflow
    expect(pipeline.releaseNotes.length).toBeGreaterThan(0);
    expect(pipeline.workflowYaml).toContain('microsoft/powerplatform-actions');
  });

  it('approves production release, promotes version, and dispatches Teams Adaptive Card notification', () => {
    let capturedNotification: any = null;
    almManager.setNotifier((card) => {
      capturedNotification = card;
    });

    const approved = almManager.approveRelease('Leon van Zyl');
    expect(approved.approvalStatus).toBe('deployed');
    expect(approved.approvedBy).toBe('Leon van Zyl');
    expect(approved.currentProdVersion).toBe('1.3.0.4');
    expect(approved.targetVersion).toBe('1.3.0.5');

    // Production environment updated
    expect(approved.environments.prod.version).toBe('1.3.0.4');
    expect(approved.simulated).toBe(true);

    // Teams notification dispatched
    expect(capturedNotification).not.toBeNull();
    expect(capturedNotification.title).toContain('Simulation:');
    expect(capturedNotification.summary).toContain('No managed solution was deployed');
  });

  it('rolls back pipeline cleanly when requested', () => {
    almManager.approveRelease();
    const rolledBack = almManager.rollbackRelease();
    expect(rolledBack.approvalStatus).toBe('pending_manager_approval');
    expect(rolledBack.targetVersion).toBe(INITIAL_ALM_PIPELINE.targetVersion);
  });
  it('rejects duplicate approval and missing rollback history', () => {
    expect(() => almManager.rollbackRelease()).toThrow('No previous');
    almManager.approveRelease();
    expect(() => almManager.approveRelease()).toThrow('already approved');
  });
  it('does not approve failed or pending gates or rewrite environment targets', () => {
    const initial = structuredClone(INITIAL_ALM_PIPELINE);
    initial.environments.test.checks[0].status = 'failed';
    const manager = new AlmPipelineManager({ pipeline: initial, history: [] });
    expect(() => manager.approveRelease()).toThrow('must pass');
    expect(manager.getPipeline().environments.prod.url).not.toBe(manager.getPipeline().environments.test.url);
  });
});
