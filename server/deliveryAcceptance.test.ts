import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryService, type DeliveryDependencies } from './delivery.ts';
import type { RepoView } from '../shared/types.ts';
import { manifestDigest } from './lifecycleGovernance.ts';
import { generateHldContent } from '../shared/hld.ts';
import {PlatformCommandError} from './platformCommandError.ts';

// Synthetic independent acceptance fixtures: all native commands/providers are injected.
const directories: string[] = [];
const services: DeliveryService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); });
const sha = 'a'.repeat(40), target = 'https://development.crm4.dynamics.com';
const categories = ['journey', 'authorization', 'persistence', 'error-handling', 'journey', 'journey'];
const states = ['loading', 'empty', 'success', 'failure', 'validation', 'recovery'];
const architectureInput={solutionName:'Synthetic expenses',problemContext:'Synthetic receipt processing',components:[]};
const architectureResult=generateHldContent(architectureInput);
const architectureHash=crypto.createHash('sha256').update(JSON.stringify({repoId:'owner/repo',input:architectureInput,result:architectureResult})).digest('hex');
const architectureArtifact={schemaVersion:1,repoId:'owner/repo',input:architectureInput,result:architectureResult,sha256:architectureHash};
const architectureAssessment={artifactSha256:architectureHash,decision:'approved',notes:'Synthetic independent review of the requirements, architecture decisions, implementation plan and remaining evidence boundaries.'};
const plan = { architecture:{docId:architectureResult.docId,sha256:architectureHash},name: 'Expenses release', owner: 'ada', qaOwner: 'sherlock', requiredIssues: [1], components: ['Expenses'], acceptanceCriteria: ['Users can create and view expenses'],
  quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['critical-flow'] },
  verification: { baseUrl: 'https://expenses.example.test', identities: ['employee', 'manager'].map((id) => ({ id, expectedUser: `${id}@example.test`, userSelector: '#user' })),
    scenarios: categories.map((category, i) => ({ name: `${category} ${i}`, category, identity: i === 1 ? 'manager' : 'employee', criterion: 0, states: [states[i]],
      steps: [{ action: 'press', selector: '#result', key: 'Tab' }, ...(category === 'persistence' ? [{ action: 'reload' }] : []), { action: 'text', selector: '#result', contains: 'Expected outcome' }] })) } };
const manifest = { schemaVersion: 1, solutionUniqueName: 'Expenses', solutionVersion: '1.0.0.1', solutionZip: 'release.zip', hasUi: true,
  recovery: { runbook: 'operations.md', rehearsalReport: 'recovery.json' }, documentation: ['README.md', 'architecture.md', 'operations.md'],
  build: [{ executable: 'build', args: [] }], test: [{ executable: 'test', args: [] }], verify: [{ executable: 'verify', args: [] }] };
async function fixture(fail?: 'test' | 'inventory' | 'evidence' | 'target' | 'independent') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-delivery-')); directories.push(root);
  await fs.mkdir(path.join(root, 'delivery-identities'));
  for (const id of ['employee', 'manager']) await fs.writeFile(path.join(root, 'delivery-identities', `${id}.json`), JSON.stringify({ cookies: [], origins: [] }));
  const calls: string[] = [];
  const deps: DeliveryDependencies = {
    async governance(request) {return {status:'clear',phase:request.phase,sourceCommit:request.sourceCommit,environmentUrl:request.environmentUrl,releaseId:request.releaseId,manifestSha256:manifestDigest(request.manifest),checkedAt:new Date().toISOString(),artifactSha256:request.packageSha256??'a'.repeat(64),policySha256:'b'.repeat(64),schemaSha256:'c'.repeat(64),reasons:['Isolated injected test governance evidence']};},
    async verify(_plan, _root, evidence) { calls.push('independent'); if (fail === 'independent') throw new Error('Independent authorization check failed'); await fs.writeFile(path.join(evidence, 'independent-verification.json'), 'browser results'); return ['independent-verification.json']; },
    async run(command, cwd, env) {
      calls.push([command.executable, ...command.args].join(' '));
      if (command.executable === 'gh') return JSON.stringify({ state: 'CLOSED' });
      if (command.executable === 'git') {
        if (command.args[0] === 'rev-parse') return sha;
        if (command.args[0] === 'show') {
          if(command.args[1].endsWith(`${architectureResult.docId}.json`))return JSON.stringify(architectureArtifact);
          if(command.args[1].endsWith(`${architectureResult.docId}.md`))return architectureResult.markdownContent;
          return JSON.stringify(manifest);
        }
        if (command.args[0] === 'worktree') {
          const checkout = command.args[3]; await fs.mkdir(checkout, { recursive: true });
          await fs.writeFile(path.join(checkout, 'cubefarm.delivery.json'), JSON.stringify(manifest));
          for (const name of manifest.documentation) await fs.writeFile(path.join(checkout, name), 'Actual project documentation');
        }
      }
      if (command.executable === 'build') {
        await fs.writeFile(path.join(cwd, 'release.zip'), 'PK build artifact');
        await fs.writeFile(path.join(cwd, 'recovery.json'), JSON.stringify({ sourceCommit: sha, performedAt: new Date().toISOString(), environmentUrl: 'https://rehearsal.crm4.dynamics.com', procedureSha256: crypto.createHash('sha256').update('Actual project documentation').digest('hex'), restored: true, dataPreserved: true, protectedRecords: [{ table: 'expenses', id: 'record-1', beforeSha256: 'b'.repeat(64), afterSha256: 'b'.repeat(64) }], evidence: ['operations.md'] }));
      }
      if (command.executable === 'test' && fail === 'test') throw new Error('Integration tests failed');
      if (command.executable === 'pac' && command.args[1] === 'list') return JSON.stringify([{ SolutionUniqueName: 'Expenses', VersionNumber: fail === 'inventory' ? '0.0.0.0' : '1.0.0.1' }]);
      if (command.executable === 'verify') {
        const report = { environmentUrl: fail === 'target' ? 'https://other.crm4.dynamics.com' : target, sourceCommit: sha, solutionUniqueName: 'Expenses', solutionVersion: '1.0.0.1', verifiedAt: new Date().toISOString(), authenticatedUser: 'tester@company.test',
          appUrls: ['https://apps.powerapps.com/play/test-app'], security: 'passed', persistence: 'passed',
          tests: ['journey', 'authorization', 'persistence', 'error-handling'].map((category) => ({ name: `Live ${category} test`, category, passed: true, evidence: 'results.json' })),
          ui: { desktop: 'desktop.png', mobile: 'mobile.png', trace: 'trace.zip', accessibility: 'passed', designReview: 'passed' } };
        for (const file of ['results.json', 'desktop.png', 'mobile.png', 'trace.zip']) if (fail !== 'evidence') await fs.writeFile(path.join(env.SWARM_DELIVERY_EVIDENCE, file), 'fixture evidence');
        await fs.writeFile(env.SWARM_DELIVERY_REPORT, JSON.stringify(report));
      }
      return '';
    },
  };
  const service = new DeliveryService(root, false, deps); services.push(service); await service.init();
  service.checkCapabilities = async () => ({ status: 'ready', configHash: 'config-v1', checks: [{ id: 'critical-flow', category: 'workflow', passed: true, remedy: 'Repair critical flow' }] });
  await service.configure(target, true);
  const repo = { id: 'owner/repo', checkoutPath: root, defaultBranch: 'main', cloneStatus: 'ready', issues: [], pulls: [] } as unknown as RepoView;
  const release = await service.createRelease(repo, plan); await service.reviewArchitecture(release.id, 'sherlock', release.planHash, architectureAssessment); await service.approveRelease(release.id, 'sherlock', release.planHash);
  return { service, repo, calls, root, deps, release };
}

const validReview = (evidenceHash: string) => ({ evidenceHash, scores: [4, 5, 4, 5, 4], notes: 'Independently inspected the synthetic evidence, exact environment and source revision, recovery and task outcomes.', recoveryReviewed: true });
function replaceManifest(deps: DeliveryDependencies, value: unknown) {
  const native = deps.run; deps.run = async (...args) => args[0].executable === 'git' && args[0].args[0] === 'show' && args[0].args[1].endsWith(':cubefarm.delivery.json') ? JSON.stringify(value) : native(...args);
}
async function reviewing() { const f = await fixture(); await f.service.start(f.repo); await f.service.waitForIdle(); expect(f.service.view().runs[0].phase).toBe('reviewing'); return { ...f, run: f.service.view().runs[0] }; }

// Full lifecycle cases use real durable journals, fsync and evidence I/O; their 15s outer fixture budget does not change the 30s production journey limit.
describe('independent delivery evidence acceptance', () => {
  it('keeps policy canonical and Copilot pause sticky without enabling tenant work in demo mode', async () => {
    const { service, repo, root, deps } = await fixture();
    await service.pauseCopilot(true); await service.configure('https://DEVELOPMENT.crm4.dynamics.com/path?ignored=1', false);
    expect(service.view().policy).toMatchObject({ enabled: false, copilotPaused: true, environmentUrl: target });
    await expect(service.start(repo)).rejects.toThrow('not enabled'); await expect(service.createRelease(repo, plan)).rejects.toThrow('Enable real');
    await expect(service.configure('http://development.crm4.dynamics.com', true)).rejects.toThrow();
    const demo = new DeliveryService(path.join(root, 'demo'), true, deps); services.push(demo); await demo.init();
    expect(demo.view().message).toContain('disabled in demo');
    await expect(demo.start(repo)).rejects.toThrow('Demo'); await expect(demo.createRelease(repo, plan)).rejects.toThrow('Enable real');
    await expect(demo.approveRelease('missing', 'sherlock', 'missing')).rejects.toThrow('unavailable');
    await expect(demo.reviewArchitecture('missing', 'sherlock', 'missing', {})).rejects.toThrow('unavailable'); await expect(demo.pauseCopilot(false)).rejects.toThrow('Configure delivery');
    await expect(demo.recoveryInspection()).rejects.toThrow('not available'); await expect(demo.recoverStartup('a'.repeat(64))).rejects.toThrow('maintenance');
  });
  it('makes exact release creation and approval idempotent but rejects changed independent identity, hash and architecture pins', async () => {
    const { service, repo, release } = await fixture(); expect((await service.createRelease(repo, plan)).id).toBe(release.id);
    const approved = await service.approveRelease(release.id, 'sherlock', release.planHash); expect(approved.approvedAt).toBe(release.approvedAt ?? approved.approvedAt);
    for (const [id, reviewer, hash] of [['missing', 'sherlock', release.planHash], [release.id, 'ada', release.planHash], [release.id, 'sherlock', 'wrong']]) {
      await expect(service.approveRelease(id, reviewer, hash)).rejects.toThrow('independent QA'); await expect(service.reviewArchitecture(id, reviewer, hash, architectureAssessment)).rejects.toThrow('independent QA');
    }
    await expect(service.reviewArchitecture(release.id, 'sherlock', release.planHash, { ...architectureAssessment, artifactSha256: 'e'.repeat(64) })).rejects.toThrow('pinned version');
    expect(service.view().releases).toHaveLength(1);
  });
  it('does not pin malformed Git revisions or execute an unapproved release', async () => {
    const f = await fixture(), native = f.deps.run;
    f.deps.run = async (...args) => args[0].executable === 'git' && args[0].args[0] === 'rev-parse' ? 'not-a-commit' : native(...args);
    await expect(f.service.createRelease(f.repo, { ...plan, name: 'Malformed revision' })).rejects.toThrow('Cannot pin');
    f.deps.run = native; const unapproved = await f.service.createRelease(f.repo, { ...plan, name: 'Awaiting QA' });
    await expect(f.service.start(f.repo, false, unapproved.id)).rejects.toThrow('Awaiting independent QA'); expect(f.service.view().runs).toHaveLength(0);
    await expect(f.service.start({ ...f.repo, id: 'unscoped/repo' })).rejects.toThrow('Create a scoped release');
  });
  it.each(['clone', 'sync', 'target', 'open-issue'] as const)('blocks %s prerequisites before build or import', async reason => {
    const f = await fixture(); let repo = f.repo;
    if (reason === 'clone') repo = { ...repo, cloneStatus: 'error' };
    if (reason === 'sync') repo = { ...repo, syncError: 'synthetic sync error' };
    if (reason === 'target') await f.service.configure('https://other.crm4.dynamics.com', true);
    if (reason === 'open-issue') { const native = f.deps.run; f.deps.run = async (...args) => args[0].executable === 'gh' ? '{"state":"OPEN"}' : native(...args); }
    await expect(f.service.start(repo)).rejects.toThrow(reason === 'target' ? 'target differs' : reason === 'open-issue' ? 'still open' : 'sync errors');
    expect(f.calls).not.toContain('build'); expect(f.calls.some(c => c.includes('solution import'))).toBe(false); expect(f.service.view().blockers).toHaveLength(1);
  });
  it.each(['wrong-commit', 'stale', 'future', 'wrong-runbook', 'duplicate-record', 'missing-evidence', 'empty-runbook'] as const)('rejects %s recovery receipts without importing', async mode => {
    const f = await fixture(), native = f.deps.run;
    f.deps.run = async (...args) => { const result = await native(...args); if (args[0].executable !== 'build') return result;
      const file = path.join(args[1], 'recovery.json'), report = JSON.parse(await fs.readFile(file, 'utf8'));
      if (mode === 'wrong-commit') report.sourceCommit = 'b'.repeat(40);
      if (mode === 'stale') report.performedAt = '2000-01-01T00:00:00.000Z';
      if (mode === 'future') report.performedAt = new Date(Date.now() + 120000).toISOString();
      if (mode === 'wrong-runbook') report.procedureSha256 = 'b'.repeat(64);
      if (mode === 'duplicate-record') report.protectedRecords.push(report.protectedRecords[0]);
      if (mode === 'missing-evidence') report.evidence = ['missing-proof.json'];
      if (mode === 'empty-runbook') await fs.writeFile(path.join(args[1], 'operations.md'), '');
      await fs.writeFile(file, JSON.stringify(report)); return result;
    };
    await f.service.start(f.repo); await f.service.waitForIdle(); const run = f.service.view().runs[0]; expect(run.phase).toBe('blocked'); expect(run.recovery).toBeUndefined(); expect(f.calls.some(c => c.includes('solution import'))).toBe(false);
  },15000);
  it.each(['wrong-commit', 'wrong-solution', 'wrong-version', 'stale', 'future', 'missing-url', 'missing-ui', 'empty-evidence', 'escaped-evidence'] as const)('withholds QA review after %s runtime evidence', async mode => {
    const f = await fixture(), native = f.deps.run;
    f.deps.run = async (...args) => { const result = await native(...args); if (args[0].executable !== 'verify') return result;
      const file = args[2].SWARM_DELIVERY_REPORT, report = JSON.parse(await fs.readFile(file, 'utf8'));
      if (mode === 'wrong-commit') report.sourceCommit = 'b'.repeat(40);
      if (mode === 'wrong-solution') report.solutionUniqueName = 'Foreign';
      if (mode === 'wrong-version') report.solutionVersion = '9.9.9.9';
      if (mode === 'stale') report.verifiedAt = '2000-01-01T00:00:00.000Z';
      if (mode === 'future') report.verifiedAt = new Date(Date.now() + 120000).toISOString();
      if (mode === 'missing-url') report.appUrls = [];
      if (mode === 'missing-ui') delete report.ui;
      if (mode === 'empty-evidence') await fs.writeFile(path.join(args[2].SWARM_DELIVERY_EVIDENCE, 'results.json'), '');
      if (mode === 'escaped-evidence') { report.tests[0].evidence = '../outside.json'; await fs.writeFile(path.join(args[2].SWARM_DELIVERY_EVIDENCE, '..', 'outside.json'), 'foreign'); }
      await fs.writeFile(file, JSON.stringify(report)); return result;
    };
    await f.service.start(f.repo); await f.service.waitForIdle(); const run = f.service.view().runs[0]; expect(run.phase).toBe('blocked'); expect(run.evidenceHash).toBeUndefined(); expect(f.calls).not.toContain('independent');
    await expect(f.service.approveVisual(run.id, 'sherlock', validReview('untrusted'))).rejects.toThrow('assigned QA');
  },15000);
  it.each(['missing', 'empty', 'outside'] as const)('refuses %s independently returned files and retains safe diagnostic files', async mode => {
    const f = await fixture(); f.deps.verify = async (_plan, _root, evidence) => {
      await fs.writeFile(path.join(evidence, 'independent-diagnostics.json'), 'diagnostic');
      if (mode === 'missing') return ['absent.json'];
      if (mode === 'empty') { await fs.writeFile(path.join(evidence, 'independent-empty.json'), ''); return ['independent-empty.json']; }
      await fs.writeFile(path.join(evidence, '..', 'foreign.json'), 'foreign'); return ['../foreign.json'];
    };
    await f.service.start(f.repo); await f.service.waitForIdle(); const run = f.service.view().runs[0]; expect(run.phase).toBe('blocked'); expect(run.evidence).toContain('independent-diagnostics.json'); expect(run.evidence).not.toContain('independent-empty.json'); expect(run.evidence).not.toContain('../foreign.json');
  },15000);
  it('independently accepts plain release evidence, refuses replay and detects later byte changes after restart', async () => {
    const f = await reviewing(); await expect(f.service.verifySliceAcceptance(f.run.id)).rejects.toThrow('Completed independent');
    await expect(f.service.approveVisual(f.run.id, 'sherlock', validReview('different'))).rejects.toThrow('Evidence changed');
    await f.service.approveVisual(f.run.id, 'sherlock', validReview(f.run.evidenceHash!)); await f.service.verifySliceAcceptance(f.run.id);
    await expect(f.service.approveVisual(f.run.id, 'sherlock', validReview(f.run.evidenceHash!))).rejects.toThrow('assigned QA');
    await f.service.close(); const restarted = new DeliveryService(f.root, false, f.deps); services.push(restarted); await restarted.init(); await restarted.verifySliceAcceptance(f.run.id);
    await fs.appendFile(path.join(f.root, 'delivery-runs', f.run.id, 'evidence', 'results.json'), 'changed'); await expect(restarted.verifySliceAcceptance(f.run.id)).rejects.toThrow('changed after independent');
  },15000);
  it('keeps health alerts scoped, deduplicates unchanged failures and clears them after verified recovery', async () => {
    const f = await reviewing(); await f.service.approveVisual(f.run.id, 'sherlock', validReview(f.run.evidenceHash!));
    const calls = f.calls.length; await f.service.monitor({ ...f.repo, id: 'foreign/repo' }, f.run.id); await f.service.monitor(f.repo, 'unknown'); expect(f.calls).toHaveLength(calls);
    const ready = f.service.checkCapabilities; f.service.checkCapabilities = async () => ({ status: 'blocked', checks: [{ id: 'critical-flow', category: 'workflow', passed: false, remedy: 'Restore synthetic capability' }] });
    await f.service.monitor(f.repo, f.run.id); expect(f.service.view().blockers).toHaveLength(1); const notify = vi.fn(); f.service.onChange = notify;
    await f.service.monitor(f.repo, f.run.id); expect(notify).not.toHaveBeenCalled();
    f.service.checkCapabilities = ready; await f.service.monitor(f.repo, f.run.id); expect(f.service.view().runs[0].health?.status).toBe('healthy'); expect(f.service.view().blockers).toHaveLength(0); expect(notify).toHaveBeenCalled();
  },15000);
  it('does not reimport a reviewing release unless a deliberate verification retry is requested', async () => {
    const f = await reviewing(), before = f.calls.length; await f.service.start(f.repo); expect(f.calls).toHaveLength(before);
    await f.service.start(f.repo, true); await f.service.waitForIdle(); expect(f.service.view().attemptHistory?.recent).toHaveLength(2);
    expect(f.calls.filter(c => c.includes('solution import'))).toHaveLength(1); expect(f.service.view().attemptHistory?.recent.some(attempt => attempt.status === 'superseded')).toBe(true);
  },15000);
  it('reports fallback capability fingerprints and supplies a local dotnet root to injected commands', async () => {
    const f = await fixture(); f.service.checkCapabilities = async () => ({ status: 'ready', checks: [{ id: 'critical-flow', category: 'workflow', passed: true, remedy: '' }] });
    const tools = path.join(f.root, 'tools', 'dotnet'); await fs.mkdir(tools, { recursive: true }); await fs.writeFile(path.join(tools, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'), 'not executable synthetic marker');
    const native = f.deps.run, observed: Record<string, string>[] = []; f.deps.run = async (...args) => { if (args[0].executable === 'build') observed.push(args[2]); return native(...args); };
    await f.service.start(f.repo); await f.service.waitForIdle(); expect(observed[0].DOTNET_ROOT).toBe(tools); expect(f.service.view().runs[0].health?.capabilityHash).toMatch(/^[a-f0-9]{64}$/);
  },15000);
  it('journals opaque post-deploy failures and refuses to replay their ambiguous effects', async () => {
    const f = await fixture(); replaceManifest(f.deps, { ...manifest, postDeploy: [{ executable: 'opaque-post', args: [] }] });
    const native = f.deps.run; f.deps.run = async (...args) => { if (args[0].executable === 'opaque-post') throw new Error('Synthetic unknown provider outcome'); return native(...args); };
    await f.service.start(f.repo); await f.service.waitForIdle(); const run = f.service.view().runs[0]; expect(run.operations?.find(op => op.id === 'post-deploy-0')?.status).toBe('unknown'); expect(run.recoveryRequired).toBe(true);
    await f.service.start(f.repo, true); await f.service.waitForIdle(); expect(f.service.view().runs[0].error).toContain('Post-deployment outcome is ambiguous'); expect(f.calls.filter(c => c.includes('solution import'))).toHaveLength(1);
  },15000);
  it.each(['normal', 'ambiguous-create', 'wrong-error', 'mapping-mismatch'] as const)('retains runner-owned native transaction evidence for %s without tenant calls', async mode => {
    const f = await fixture(), original = f.deps.run;
    f.service.checkCapabilities = async () => ({ status: 'ready', configHash: 'synthetic-api', checks: [{ id: 'critical-auth', category: 'authentication', passed: true, remedy: '' }, { id: 'critical-environment', category: 'environment', passed: true, remedy: '' }] });
    const id = '11111111-1111-4111-8111-111111111111', lineId = '22222222-2222-4222-8222-222222222222';
    const transaction = { entitySet: 'exp_reports', idField: 'exp_reportid', nameField: 'exp_title', maxNameLength: 100, values: { exp_amount: 0, exp_status: 1 }, childEntitySet: 'exp_lines', childLookup: '_exp_report_value', childIdField: 'exp_lineid', validationErrorCodes: ['0x80073001'] };
    const components = [{ key: 'reports', kind: 'dataverse-table', logicalName: 'exp_report' }, { key: 'lines', kind: 'dataverse-table', logicalName: 'exp_line' }];
    const owned = { ...manifest, hasUi: false, manualDevelopmentGovernance: true, recovery: { runbook: 'operations.md', scope: 'pilot-owned-development-records' }, targetBinding: { organizationId: id, userId: id }, platformIdentity: { tenantId: id, username: 'maker@example.test', environmentId: id }, targetComponents: components };
    const rows = new Map<string, Record<string, unknown>>(), versions = new Map<string, number>(), writes: { method: string; body?: Record<string, unknown> }[] = [];
    f.deps.run = async (...args) => {
      const command = args[0];
      if (command.executable === 'git' && command.args[0] === 'show' && command.args[1].endsWith(':cubefarm.delivery.json')) return JSON.stringify(owned);
      if (command.executable === 'pac' && command.args[0] === 'org') return `Org ID: ${id}\nUser ID: ${id}\nOrg URL: ${target}\nEnvironment ID: ${id}\nUser Email: maker@example.test`;
      if (command.executable !== 'dataverse') { const result = await original(...args); if (command.executable === 'git' && command.args[0] === 'worktree') await fs.writeFile(path.join(command.args[3], 'release.zip'), 'PK build artifact'); return result; }
      if (command.args[0] === 'auth') return `Tenant: ${id}\nUser: maker@example.test\nEnvironment: ${target}`;
      const resource = command.args[command.args.indexOf('--path') + 1].replace('/api/data/v9.2/', ''), method = command.args[command.args.indexOf('--method') + 1];
      const bodyIndex = command.args.indexOf('--body'), body = bodyIndex >= 0 ? JSON.parse(command.args[bodyIndex + 1]) : undefined;
      if (resource === 'WhoAmI') return JSON.stringify({ OrganizationId: id, UserId: id });
      if (resource.includes('RetrieveCurrentOrganization')) return JSON.stringify({ Detail: { OrganizationId: id, EnvironmentId: id, TenantId: id, State: 'Enabled' } });
      if (resource.startsWith('solutions?')) return JSON.stringify({ value: [{ solutionid: id }] });
      if (resource.startsWith('solutioncomponents?')) return JSON.stringify({ value: [{ objectid: id, componenttype: 1 }, { objectid: lineId, componenttype: 1 }] });
      if (resource.startsWith('EntityDefinitions')) { const header = resource.includes("'exp_report'"); return JSON.stringify({ MetadataId: header ? id : lineId, EntitySetName: header ? 'exp_reports' : 'exp_lines', PrimaryIdAttribute: mode === 'mapping-mismatch' && header ? 'wrong_id' : header ? 'exp_reportid' : 'exp_lineid' }); }
      if (method === 'GET' && (resource.startsWith('exp_reports?') || resource.startsWith('exp_lines?'))) return '{"value":[]}';
      const key = resource.match(/^exp_reports\(([a-f0-9-]+)\)/)?.[1];
      if (method === 'GET' && key) return JSON.stringify({ ...rows.get(key), '@odata.etag': `W/"${versions.get(key)}"`, versionnumber: versions.get(key) });
      writes.push({ method, body });
      if (method === 'POST') { if (mode === 'ambiguous-create') throw new Error('Synthetic unknown create outcome'); rows.set(body.exp_reportid, { ...body, _ownerid_value: id }); versions.set(body.exp_reportid, 1); return ''; }
      if (method === 'PATCH' && key) {
        const header = command.args[command.args.indexOf('--header') + 1]; expect(header).toBe(`If-Match:W/"${versions.get(key)}"`);
        if (body.exp_title.length > 100) throw new PlatformCommandError('Synthetic server length validation', mode === 'wrong-error' ? '0x80040220' : '0x80073001');
        rows.set(key, { ...rows.get(key), ...body }); versions.set(key, versions.get(key)! + 1); return '';
      }
      throw new Error(`Unexpected synthetic native request ${method} ${resource}`);
    };
    const backend = { ...plan, monitoring: { intervalMinutes: 15, criticalProbeIds: ['critical-auth', 'critical-environment'] }, acceptanceProfile: 'functional-development', verification: { baseUrl: target, identities: [], scenarios: [], api: { binding: { organizationId: id, userId: id }, transaction,
      checks: ['journey', 'authorization', 'persistence', 'error-handling'].map(category => ({ name: `Synthetic ${category}`, category, criterion: 0, resource: 'WhoAmI', assertions: [{ pointer: ['UserId'], equals: id }] })) } } };
    const release = await f.service.createRelease(f.repo, backend); await f.service.reviewArchitecture(release.id, 'sherlock', release.planHash, architectureAssessment); await f.service.approveRelease(release.id, 'sherlock', release.planHash);
    await f.service.start(f.repo, false, release.id); await f.service.waitForIdle(); const run = f.service.view().runs[0], directory = path.join(f.root, 'delivery-runs', run.id, 'evidence');
    if (mode === 'mapping-mismatch') { expect(run.phase).toBe('blocked'); expect(run.error).toContain('declared mapped table'); expect(writes).toEqual([]); return; }
    const receiptFiles = (await fs.readdir(directory)).filter(file => file.startsWith('native-operation-'));
    expect(receiptFiles.length, run.error).toBeGreaterThan(0); const receipts = await Promise.all(receiptFiles.map(async file => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'))));
    expect(receipts.every(receipt => receipt.runId === run.id && receipt.sourceCommit === sha && receipt.releaseId === release.id && receipt.environmentUrl === target && /^[a-f0-9]{64}$/.test(receipt.requestSha256))).toBe(true);
    expect(receipts.some(receipt => receipt.outcome === 'failed-or-unknown')).toBe(true); expect(writes.some(write => write.method === 'DELETE')).toBe(false);
    if (mode !== 'normal') { expect(run.phase).toBe('blocked'); expect(run.error).toContain(mode === 'ambiguous-create' ? 'unknown create' : 'length validation'); expect(f.calls.some(c => c.includes('solution import'))).toBe(false); return; }
    expect(run.phase, run.error).toBe('reviewing'); expect(writes).toHaveLength(8); expect(run.evidence).toContain('independent-recovery-journal.json'); expect(run.evidence).toContain('independent-journey-journal.json');
    expect(run.appUrls).toEqual([]); await f.service.approveVisual(run.id, 'sherlock', { ...validReview(run.evidenceHash!), scores: [] }); expect(f.service.view().runs[0].phase).toBe('complete');
  },15000);
  it.each(['schema-sharing', 'binding-repair', 'mapping-drift'] as const)('reconciles typed %s against independent reads before allowing QA', async mode => {
    const f = await fixture(), native = f.deps.run, id = '11111111-1111-4111-8111-111111111111', principal = '22222222-2222-4222-8222-222222222222';
    const table = { key: 'reports', kind: 'dataverse-table', logicalName: 'exp_report' }, reference = { key: 'reference', kind: 'connection-reference', logicalName: 'exp_reference' };
    const schema = { id: 'schema', type: 'schema-check', component: 'reports', columns: [{ name: 'exp_title', type: 'String', required: 'None' }] };
    const share = { id: 'share', type: 'record-share', component: 'reports', recordId: id, principalId: principal, principalType: 'systemuser', expectedRights: [], rights: ['ReadAccess'] };
    const check = { id: 'binding', type: 'connection-reference-check', component: 'reference', connectionId: 'approved', connectorId: 'dataverse-connector' };
    const repair = { id: 'repair', type: 'connection-reference-bind', component: 'reference', expectedConnectionId: 'old', connectionId: 'approved', connectorId: 'dataverse-connector' };
    const typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, targetComponents: mode === 'binding-repair' ? [reference] : [table], postDeployActions: mode === 'binding-repair' ? [check, repair] : [share, schema] };
    let connection = 'old', shared = false, mappings = 0; const writes: string[] = [];
    f.deps.run = async (...args) => {
      const cmd = args[0]; if (cmd.executable === 'git' && cmd.args[0] === 'show' && cmd.args[1].endsWith(':cubefarm.delivery.json')) return JSON.stringify(typed);
      if (cmd.executable !== 'dataverse') return native(...args);
      const resource = cmd.args[cmd.args.indexOf('--path') + 1].replace('/api/data/v9.2/', ''), method = cmd.args[cmd.args.indexOf('--method') + 1];
      if (resource === 'WhoAmI') return JSON.stringify({ OrganizationId: id, UserId: id });
      if (resource.startsWith('solutions?')) return JSON.stringify({ value: [{ solutionid: id }] });
      if (resource.startsWith('solutioncomponents?')) { mappings++; return JSON.stringify({ value: [{ objectid: id, componenttype: mode === 'binding-repair' ? 10039 : 1 }] }); }
      if (resource.startsWith('connectionreferences?')) return JSON.stringify({ value: [{ connectionreferenceid: id }] });
      if (resource.startsWith('connectionreferences(')) { if (method === 'PATCH') { writes.push('bind'); connection = 'approved'; return ''; } return JSON.stringify({ connectionid: connection, connectorid: 'dataverse-connector', statecode: 0, '@odata.etag': 'W/"1"' }); }
      const attribute = { LogicalName: 'exp_title', MetadataId: id, AttributeType: 'String', RequiredLevel: { Value: 'None' } };
      if (resource.startsWith('EntityDefinitions?')) return JSON.stringify({ value: [{ LogicalName: 'exp_report', Attributes: [attribute] }] });
      if (resource.includes('/Attributes?')) return JSON.stringify({ value: [attribute] });
      if (resource.startsWith('EntityDefinitions(')) return JSON.stringify({ MetadataId: id, EntitySetName: 'exp_reports', PrimaryIdAttribute: mode === 'mapping-drift' && mappings > 1 ? 'exp_renamedid' : 'exp_reportid' });
      if (resource.startsWith('systemusers(')) return JSON.stringify({ systemuserid: principal, isdisabled: false });
      if (resource.startsWith('exp_reports(')) return JSON.stringify({ exp_reportid: id });
      if (resource.startsWith('RetrieveSharedPrincipalsAndAccess')) return JSON.stringify({ PrincipalAccesses: shared ? [{ Principal: { systemuserid: principal }, AccessMask: 'ReadAccess' }] : [] });
      if (resource === 'GrantAccess') { writes.push('share'); shared = true; return ''; }
      throw new Error(`Unexpected synthetic typed request ${method} ${resource}`);
    };
    await f.service.start(f.repo); await f.service.waitForIdle(); const run = f.service.view().runs[0];
    if (mode === 'mapping-drift') { expect(run.phase).toBe('blocked'); expect(run.error).toContain('mapping changed after deployment'); }
    else { expect(run.phase, run.error).toBe('reviewing'); expect(run.operations?.filter(op => op.id.startsWith('typed:')).every(op => op.status === 'verified')).toBe(true); await f.service.approveVisual(run.id, 'sherlock', validReview(run.evidenceHash!)); }
    expect(writes).toEqual([mode === 'binding-repair' ? 'bind' : 'share']); expect(f.calls.filter(c => c.includes('solution import'))).toHaveLength(1);
  },15000);
  it.each(['missing-platform-identity', 'unmapped-action', 'duplicate-components', 'duplicate-actions', 'unverified-bind', 'unpublished-copilot'] as const)('holds unsafe %s committed manifest before build or import', async mode => {
    const f = await fixture(), id = '11111111-1111-4111-8111-111111111111', component = { key: 'flow', kind: 'cloud-flow', logicalName: 'exp_flow' };
    let typed: unknown;
    if (mode === 'missing-platform-identity') typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, targetComponents: [component] };
    if (mode === 'unmapped-action') typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, postDeployActions: [{ id: 'activate', type: 'workflow-state', component: 'missing', state: 'active' }] };
    if (mode === 'duplicate-components') typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, targetComponents: [{ key: 'table', kind: 'dataverse-table', logicalName: 'exp_table' }, { key: 'table', kind: 'dataverse-table', logicalName: 'exp_other' }] };
    if (mode === 'duplicate-actions') typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, targetComponents: [{ key: 'flow', kind: 'workflow', logicalName: 'exp_flow' }], postDeployActions: [0, 1].map(() => ({ id: 'activate', type: 'workflow-state', component: 'flow', state: 'active' })) };
    if (mode === 'unverified-bind') typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, targetComponents: [{ key: 'reference', kind: 'connection-reference', logicalName: 'exp_reference' }], postDeployActions: [{ id: 'bind', type: 'connection-reference-bind', component: 'reference', connectionId: 'approved', expectedConnectionId: null, connectorId: 'connector' }] };
    if (mode === 'unpublished-copilot') typed = { ...manifest, targetBinding: { organizationId: id, userId: id }, platformIdentity: { tenantId: id, username: 'maker@example.test', environmentId: id }, targetComponents: [{ key: 'agent', kind: 'copilot', logicalName: 'exp_agent' }] };
    replaceManifest(f.deps, typed); await expect(f.service.start(f.repo)).rejects.toThrow(); expect(f.calls).not.toContain('build'); expect(f.calls.some(call => call.includes('solution import'))).toBe(false); expect(f.service.view().runs).toEqual([]);
  });
  it.each(['flow-without-runtime-check', 'unknown-flow-check', 'copilot-without-runtime-check', 'copilot-paused', 'backend-without-api', 'api-certifying-ui', 'api-binding-mismatch'] as const)('withholds deployment for %s runtime scope', async mode => {
    const f = await fixture(), id = '11111111-1111-4111-8111-111111111111';
    const binding = { organizationId: id, userId: id }, identity = { tenantId: id, username: 'maker@example.test', environmentId: id };
    const typed = mode.startsWith('flow') ? { ...manifest, targetBinding: binding, platformIdentity: identity, targetComponents: [{ key: 'flow', kind: 'cloud-flow', logicalName: 'exp_flow' }] }
      : mode.startsWith('copilot') ? { ...manifest, targetBinding: binding, platformIdentity: identity, targetComponents: [{ key: 'agent', kind: 'copilot', logicalName: 'exp_agent' }], postDeployActions: [{ id: 'publish', type: 'copilot-publish', component: 'agent' }] }
      : mode === 'backend-without-api' ? { ...manifest, hasUi: false } : manifest;
    replaceManifest(f.deps, typed); const patched = f.deps.run;
    f.deps.run = async (...args) => args[0].executable === 'dataverse' ? JSON.stringify({ OrganizationId: id, UserId: id }) : patched(...args);
    if (mode === 'copilot-paused') await f.service.pauseCopilot(true);
    let releaseId: string | undefined;
    if (mode === 'unknown-flow-check' || mode.startsWith('api-')) {
      const verification = mode === 'unknown-flow-check' ? { ...plan.verification, cloudFlowChecks: [{ component: 'missing', action: 'Audit', correlationPointer: ['body', 'releaseId'], assertions: [{ pointer: ['body', 'saved'], equals: true }] }] }
        : { baseUrl: target, identities: [], scenarios: [], api: { binding, checks: ['journey', 'authorization', 'persistence', 'error-handling'].map(category => ({ name: `Synthetic ${category}`, category, criterion: 0, resource: 'WhoAmI', assertions: [{ pointer: ['UserId'], equals: id }] })) } };
      if (mode === 'api-binding-mismatch') { f.deps.run = async (...args) => args[0].executable === 'git' && args[0].args[0] === 'show' && args[0].args[1].endsWith(':cubefarm.delivery.json') ? JSON.stringify({ ...manifest, hasUi: false }) : patched(...args); }
      const release = await f.service.createRelease(f.repo, { ...plan, acceptanceProfile: 'functional-development', verification }); await f.service.reviewArchitecture(release.id, 'sherlock', release.planHash, architectureAssessment); await f.service.approveRelease(release.id, 'sherlock', release.planHash); releaseId = release.id;
    }
    await f.service.start(f.repo, false, releaseId); await f.service.waitForIdle(); const run = f.service.view().runs[0]; expect(run.phase).toBe('blocked');
    const expected = mode === 'flow-without-runtime-check' ? 'QA-owned correlated' : mode === 'unknown-flow-check' ? 'unknown component' : mode === 'copilot-without-runtime-check' ? 'published-channel' : mode === 'copilot-paused' ? 'paused by the user' : mode === 'backend-without-api' ? 'require API verification' : mode === 'api-certifying-ui' ? 'cannot certify a UI' : 'approved target binding';
    expect(run.error).toContain(expected); expect(f.calls).not.toContain('build'); expect(f.calls.some(call => call.includes('solution import'))).toBe(false);
  });
  it('keeps active deployment ownership exclusive across policy, review and competing start requests', async () => {
    const f = await fixture(), provider = f.deps.governance!; let entered!: () => void, complete!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { complete = resolve; });
    f.deps.governance = async request => { const result = await provider(request); if (request.phase === 'build') { entered(); await held; } return result; };
    try { await f.service.start(f.repo); await pending;
      await expect(f.service.configure(target, false)).rejects.toThrow('active delivery'); await expect(f.service.start(f.repo)).rejects.toThrow('already running'); await expect(f.service.createRelease(f.repo, plan)).rejects.toThrow('active run');
      await expect(f.service.pauseCopilot(true)).rejects.toThrow('active run'); await expect(f.service.reviewArchitecture(f.release.id, 'sherlock', f.release.planHash, architectureAssessment)).rejects.toThrow('during delivery'); await expect(f.service.approveVisual(f.service.view().runs[0].id, 'sherlock', validReview('a'.repeat(64)))).rejects.toThrow('active delivery');
      const count = f.calls.length; await f.service.tick([f.repo]); await f.service.monitor(f.repo, f.service.view().runs[0].id); expect(f.calls).toHaveLength(count); expect(f.service.view('foreign/repo').runs).toEqual([]); expect(f.service.view('foreign/repo').releases).toEqual([]);
    } finally { complete(); await f.service.waitForIdle(); }
    expect(f.service.view().runs[0].phase).toBe('reviewing');
  },15000);
  it('rejects a release prepared while its policy becomes disabled and retains the prior reviewed release', async () => {
    const f = await fixture(), native = f.deps.run; let changed = false;
    f.deps.run = async (...args) => { if (!changed && args[0].executable === 'git' && args[0].args[0] === 'fetch') { changed = true; await f.service.configure(target, false); } return native(...args); };
    await expect(f.service.createRelease(f.repo, { ...plan, name: 'Changed during fetch' })).rejects.toThrow('state changed during release preparation'); expect(f.service.view().releases).toHaveLength(1); expect(f.service.view().releases[0].id).toBe(f.release.id); expect(f.calls).not.toContain('build');
  });
  it('keeps durable changes after a notification callback fails and does not replay a completed release from automatic tick', async () => {
    const f = await reviewing(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); f.service.onChange = () => { throw new Error('Synthetic notification failure'); };
    try { await f.service.approveVisual(f.run.id, 'sherlock', validReview(f.run.evidenceHash!)); expect(warn).toHaveBeenCalled(); const before = f.calls.length; await f.service.tick([f.repo]); expect(f.calls).toHaveLength(before); expect(f.service.view().runs[0].phase).toBe('complete'); }
    finally { warn.mockRestore(); }
  },15000);
  it('performs only health reads on a due completed run and reports installed-version drift instead of reimporting', async () => {
    const f = await reviewing(); await f.service.approveVisual(f.run.id, 'sherlock', validReview(f.run.evidenceHash!)); const native = f.deps.run;
    f.deps.run = async (...args) => args[0].executable === 'pac' && args[0].args[1] === 'list' ? '[{"SolutionUniqueName":"Expenses","VersionNumber":"9.9.9.9"}]' : native(...args);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60000), before = f.calls.length;
    try { await f.service.tick([f.repo]); expect(f.service.view().runs[0].health).toMatchObject({ status: 'degraded', error: expect.stringContaining('version drift') }); expect(f.calls.slice(before).some(c => c.includes('solution import'))).toBe(false); }
    finally { clock.mockRestore(); }
  },15000);
  it.each(['frame', 'no-installed-version'] as const)('retains bounded verification scope and recovery behavior for %s', async mode => {
    const f = await fixture(); if (mode === 'frame') { const release = await f.service.createRelease(f.repo, { ...plan, verification: { ...plan.verification, frame: { selector: '#app', origin: 'https://embedded.example.test' } } }); await f.service.reviewArchitecture(release.id, 'sherlock', release.planHash, architectureAssessment); await f.service.approveRelease(release.id, 'sherlock', release.planHash); }
    await f.service.start(f.repo); await f.service.waitForIdle(); const run = f.service.view().runs[0];
    if (mode === 'frame') { const scope = JSON.parse(await fs.readFile(path.join(f.root, 'delivery-runs', run.id, 'evidence', 'acceptance-scope.json'), 'utf8')); expect(scope.independentMethod).toBe('browser-frame'); return; }
    await f.service.close(); const file = path.join(f.root, 'delivery.json'), state = JSON.parse(await fs.readFile(file, 'utf8')); state.runs[0].phase = 'deploying'; state.runs[0].checkpoint = 'import-started'; await fs.writeFile(file, JSON.stringify(state));
    const native = f.deps.run; f.deps.run = async (...args) => args[0].executable === 'pac' && args[0].args[1] === 'list' ? '[]' : native(...args);
    const restored = new DeliveryService(f.root, false, f.deps); services.push(restored); await restored.init(); restored.checkCapabilities = f.service.checkCapabilities; const count = f.calls.filter(c => c.includes('solution import')).length;
    await restored.start(f.repo, true); await restored.waitForIdle(); expect(restored.view().runs[0].error).toContain('version not found'); expect(f.calls.filter(c => c.includes('solution import'))).toHaveLength(count);
  },15000);
});
