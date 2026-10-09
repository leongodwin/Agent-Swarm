import { type AlmPipeline, INITIAL_ALM_PIPELINE } from '../shared/alm.ts';
import { HttpError } from './httpError.ts';

/** A labelled release simulation. Real deployments require an integration, never fixture claims. */
export class AlmPipelineManager {
  private pipeline: AlmPipeline;
  private history: AlmPipeline[];
  private notifier?: (card: { title: string; subtitle?: string; summary?: string; facts?: { title: string; value: string }[] }) => void;
  constructor(saved?: { pipeline: AlmPipeline; history: AlmPipeline[] }) {
    this.pipeline = structuredClone(saved?.pipeline ?? INITIAL_ALM_PIPELINE);
    this.history = structuredClone(saved?.history ?? []);
    this.pipeline.simulated = true;
  }
  setNotifier(fn: NonNullable<AlmPipelineManager['notifier']>) { this.notifier = fn; }
  getPipeline(): AlmPipeline { return structuredClone(this.pipeline); }
  serialize() { return { pipeline: this.getPipeline(), history: structuredClone(this.history) }; }
  approveRelease(approver = 'Manager'): AlmPipeline {
    if (this.pipeline.approvalStatus !== 'pending_manager_approval') throw new HttpError(409, 'This simulated release was already approved');
    const stages = [this.pipeline.environments.dev, this.pipeline.environments.test];
    if (stages.some((env) => env.buildStatus !== 'clean' || env.checks.some((check) => check.status !== 'passed'))) {
      throw new HttpError(409, 'All development and test gates must pass before approval');
    }
    this.history.push(this.getPipeline());
    if (this.history.length > 20) this.history.shift();
    const version = this.pipeline.targetVersion;
    Object.assign(this.pipeline, { approvalStatus: 'deployed', approvedBy: approver, approvedAt: new Date().toISOString(), currentProdVersion: version });
    Object.assign(this.pipeline.environments.prod, { version, lastDeployedAt: `Simulated approval by ${approver}`,
      unpackedCommitSha: this.pipeline.environments.test.unpackedCommitSha });
    const parts = version.split('.').map(Number);
    if (parts.length === 4 && parts.every(Number.isInteger)) { parts[3]++; this.pipeline.targetVersion = parts.join('.'); }
    this.notifier?.({ title: `Simulation: release v${version} approved`, subtitle: 'Local ALM simulation',
      summary: `Approved by ${approver}. No managed solution was deployed.`, facts: [{ title: 'Version', value: version }] });
    return this.getPipeline();
  }
  rollbackRelease(): AlmPipeline {
    const previous = this.history.pop();
    if (!previous) throw new HttpError(409, 'No previous simulated release to restore');
    this.pipeline = previous;
    return this.getPipeline();
  }
}
