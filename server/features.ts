import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { FlowRun } from '../shared/flowTelemetry.ts';
import { INITIAL_FLOW_RUNS } from '../shared/flowTelemetry.ts';
import { buildTeamsCard, formatAdaptiveCardJson, type TeamsAdaptiveCard } from '../shared/teams.ts';
import { AlmPipelineManager } from './almGate.ts';
import { atomicWrite, SerialWriter } from './atomicFile.ts';
import { HttpError } from './httpError.ts';

interface ScopeState { runs: FlowRun[]; feed: TeamsAdaptiveCard[]; alm: ReturnType<AlmPipelineManager['serialize']> }
type CardInput = Parameters<typeof buildTeamsCard>[0];

/** Repository/environment-scoped simulation history, persisted independently from swarm state. */
export class FeatureStore {
  private state: Record<string, ScopeState> = {};
  private writer = new SerialWriter();
  constructor(private file: string, private demo: boolean, private webhook?: string, private send: typeof fetch = fetch) {}
  async init() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid feature state');
      for (const value of Object.values(parsed) as ScopeState[]) {
        if (!Array.isArray(value.runs) || !Array.isArray(value.feed) || !value.alm?.pipeline || !Array.isArray(value.alm.history)) throw new Error('Invalid feature scope');
      }
      this.state = parsed;
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }
  private scope(key: string): ScopeState {
    return this.state[key] ??= { runs: structuredClone(INITIAL_FLOW_RUNS), feed: [], alm: new AlmPipelineManager().serialize() };
  }
  private save() { return atomicWrite(this.file, JSON.stringify(this.state)); }
  private mutate<T>(fn: () => Promise<T>) {
    return this.writer.write(async () => {
      const before = structuredClone(this.state);
      try { return await fn(); } catch (err) { this.state = before; throw err; }
    });
  }
  runs(key: string) { return structuredClone(this.scope(key).runs); }
  feed(key: string) { return structuredClone(this.scope(key).feed); }
  pipeline(key: string) { return new AlmPipelineManager(this.scope(key).alm).getPipeline(); }
  resubmit(key: string, id: string) {
    return this.mutate(async () => {
      const scope = this.scope(key);
      const found = scope.runs.find((run) => run.id === id);
      if (!found) throw new HttpError(404, 'Flow run not found in this repository');
      const run: FlowRun = { ...structuredClone(found), id: `simulation-${crypto.randomUUID()}`, startedAt: new Date().toISOString(), status: 'Running' };
      scope.runs.unshift(run); scope.runs = scope.runs.slice(0, 100);
      await this.save();
      return { ok: true, resubmitted: structuredClone(run), simulated: true };
    });
  }
  async notify(key: string, input: CardInput) {
    const card = buildTeamsCard(input);
    if (!this.demo && this.webhook) {
      const response = await this.send(this.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formatAdaptiveCardJson(card)), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new HttpError(502, `Teams rejected the notification (${response.status})`);
    }
    await this.mutate(async () => { const scope = this.scope(key); scope.feed.unshift(card); scope.feed = scope.feed.slice(0, 20); await this.save(); });
    return { ok: true, card, delivered: !this.demo && !!this.webhook, simulated: this.demo };
  }
  async release(key: string, action: 'approve' | 'rollback', approver?: string) {
    await this.mutate(async () => {
      const scope = this.scope(key);
      const manager = new AlmPipelineManager(scope.alm);
      // Simulation notifications stay in the local feed even in a real office.
      manager.setNotifier((input) => { scope.feed.unshift(buildTeamsCard({ ...input, subtitle: input.subtitle ?? '', summary: input.summary ?? '' })); scope.feed = scope.feed.slice(0, 20); });
      if (action === 'approve') manager.approveRelease(approver); else manager.rollbackRelease();
      scope.alm = manager.serialize();
      await this.save();
    });
    return this.pipeline(key);
  }
}
