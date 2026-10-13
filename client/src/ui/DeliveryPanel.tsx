import { useEffect, useState } from 'react';
import { Panel } from './Overlays';
import { useStore, repoOnFloor } from '../store';
import { api } from '../api';
import { useResource } from '../useResource';

export function DeliveryPanel({ onClose }: { onClose?: () => void }) {
  const repos = useStore((s) => s.repos);
  const floorRepo = useStore((s) => repoOnFloor(s.repos, s.floor));
  const [selected, setSelected] = useState(floorRepo?.id ?? repos[0]?.id ?? '');
  const [capabilityConfig, setCapabilityConfig] = useState('');
  const capabilities = useResource('capabilities', api.capabilities);
  const templates = useResource('templates', api.templates);
  const skills = useResource('installed-skills', api.installedSkills);
  const [plan, setPlan] = useState('');
  const [planError, setPlanError] = useState('');
  const [busy, setBusy] = useState(false);
  const resource = useResource(selected, () => api.delivery(selected || undefined));
  const tenancy = useResource('tenancy', api.tenancy);
  useEffect(() => { const timer = setInterval(() => { resource.refresh(); capabilities.refresh(); }, 5000); return () => clearInterval(timer); }, [selected]);
  const data = resource.value;
  const target = tenancy.value?.environments.find((env) => env.active);
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); resource.refresh(); capabilities.refresh(); } catch { /* API displays the failure */ } finally { setBusy(false); } };
  return <Panel title="Solution delivery" wide onClose={onClose}>
    <p>Build, test, deploy and verify your solution in its approved development environment.</p>
    <div className="row wrap">
      <label>Project <select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">All projects</option>{repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}</option>)}</select></label>
      <button className="btn" disabled={busy || data?.running || (!data?.policy?.enabled && (!target || tenancy.value?.status !== 'connected'))} onClick={() => void action(() => api.configureDelivery(!data?.policy?.enabled))}>{data?.policy?.enabled ? 'Pause automatic delivery' : 'Enable delivery to connected development environment'}</button>
      <button className="btn btn-ghost" disabled={busy || data?.running || !data?.policy?.enabled || !selected} onClick={() => void action(() => api.runDelivery(selected))}>Run / resume latest release</button>
    </div>
    <p><strong>Deployment target:</strong> {data?.policy?.environmentUrl ?? target?.url ?? 'Connect a development environment first'}</p>
    {data?.policy?.copilotPaused && <p>Copilot Studio delivery is paused. Other solution components can continue through their own approved release.</p>}
    <p className="muted">{resource.error ?? data?.message ?? 'Loading delivery status…'}</p>
    <details><summary>Capabilities and implementation starters</summary>
      <p>Live readiness checks run before new work. Missing access stays blocked until configured and verified.</p>
      <details><summary>Installed Power Platform skills ({skills.value?.skills.length ?? 0})</summary>
        <p>Codex and office agents use these instructions. Tool access and tenant readiness are checked separately.</p>
        {skills.error && <p role="alert">{skills.error}</p>}
        <button className="btn btn-ghost" onClick={() => skills.refresh()}>Refresh skills</button>
        {skills.value?.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        <ul>{skills.value?.skills.map((skill) => <li key={`${skill.id}:${skill.file}`}><strong>{skill.id}</strong> · {skill.platform} · {skill.version ?? 'shared instructions'}{skill.activation === 'unconfirmed' && ' · plugin activation unconfirmed'} · runtime tools unverified</li>)}</ul>
      </details>
      {capabilities.error && <p role="alert">{capabilities.error}</p>}
      {capabilities.value?.results.filter((r) => !selected || r.repoId === selected).map((result) => <div key={result.repoId}><strong>{result.repoId}: {result.status}</strong><ul>{result.checks.map((check) => <li key={check.id}>{check.passed ? 'Passed' : 'Blocked'} — {check.id}{!check.passed && `: ${check.remedy}`}</li>)}</ul></div>)}
      <button className="btn" disabled={busy || !selected} onClick={() => void action(() => api.checkCapabilities(selected))}>Refresh readiness</button>
      <details><summary>Configure project probes</summary><p>Use the capability contract in docs/DELIVERY.md. Store credential environment-variable names only.</p><textarea aria-label="Capability configuration JSON" value={capabilityConfig} rows={8} onChange={(event) => setCapabilityConfig(event.target.value)} style={{ width: '100%' }} /><button className="btn" disabled={busy || !selected || !capabilityConfig} onClick={() => { try { const config = JSON.parse(capabilityConfig); setPlanError(''); void action(() => api.configureCapabilities(selected, config)); } catch { setPlanError('Enter valid JSON'); } }}>Save probe configuration</button></details>
      {templates.value?.map((template) => <p key={template.id}><strong>{template.id} v{template.version}</strong> · {template.validation} <button className="btn btn-ghost" disabled={busy || !selected} onClick={() => void action(() => api.installTemplate(selected, template.id))}>Add starter reference bundle</button></p>)}
    </details>
    {data?.blockers?.map((blocker) => <p role="alert" key={blocker.repoId}><strong>{blocker.owner}:</strong> {blocker.error}<br />{blocker.recovery}{blocker.preflightRetry&&<><br />Preflight failures: {blocker.preflightRetry.failures}. {blocker.preflightRetry.nextAttemptAt?`Automatic retry after ${new Date(blocker.preflightRetry.nextAttemptAt).toLocaleString()}.`:'Automatic retries paused; resolve the prerequisite and run the release manually.'}</>}</p>)}
    <details><summary>Create a scoped release</summary><p>Paste the release plan JSON defined in docs/DELIVERY.md. The assigned QA agent must review and approve the pinned plan before it runs.</p><textarea aria-label="Release plan JSON" rows={10} value={plan} onChange={(event) => setPlan(event.target.value)} style={{ width: '100%' }} /><button className="btn" disabled={busy || !selected || !plan || !data?.policy?.enabled} onClick={() => { try { const parsed = JSON.parse(plan); setPlanError(''); void action(() => api.createRelease(selected, parsed)); } catch { setPlanError('Enter valid JSON'); } }}>Create release</button>{planError && <p role="alert">{planError}</p>}</details>
    {data?.releases?.map((release) => <section key={release.id}><p><strong>{release.plan.name}</strong> · {release.head.slice(0, 8)} · {release.approvedAt ? `QA approved by ${release.approvedBy}` : `Awaiting ${release.plan.qaOwner}`}</p>{(!release.approvedAt || data.runs.some((run) => run.releaseId === release.id && run.phase === 'reviewing')) && <button className="btn btn-ghost" disabled={busy} onClick={() => void action(() => api.reviewRelease(release.id))}>Request assigned QA review</button>}<p>Architecture: {release.plan.architecture?.docId ?? 'missing version'} · {release.architectureReview ? `${release.architectureReview.decision} by ${release.architectureReview.reviewer}` : 'independent review pending'}</p>{release.architectureReview && <p>{release.architectureReview.notes}</p>}<p>Required issues: {release.plan.requiredIssues.map((n) => `#${n}`).join(', ')} · Components: {release.plan.components.join(', ')}</p><details><summary>Acceptance plan</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(release.plan, null, 2)}</pre></details><button className="btn btn-ghost" disabled={busy || data.running || !release.approvedAt || release.architectureReview?.decision !== 'approved' || !data.policy?.enabled} onClick={() => void action(() => api.runDelivery(release.repoId, release.id))}>Run / resume this release</button></section>)}
    {!data?.runs.length && <p>No verified delivery yet. The team must finish the solution and its delivery checks before it can appear here as complete.</p>}
    {data?.runs.map((run) => <section key={run.id} style={{ border: '1px solid #334155', borderRadius: 10, padding: 16, marginTop: 12 }}>
      <div className="row wrap"><strong>{run.solution ?? run.repoId} {run.version ?? ''}</strong><span style={{ color: run.health?.status === 'degraded' ? '#fb7185' : run.phase === 'complete' ? '#4ade80' : run.phase === 'blocked' ? '#fb7185' : '#7dd3fc' }}>{run.health?.status === 'degraded' ? 'Deployed; health degraded' : run.phase === 'complete' ? run.acceptance?.profile === 'functional-development' ? 'Development functionality verified' : 'Deployed and verified' : run.phase}</span></div>
      {run.acceptance?.limitations.map((limitation) => <p key={limitation}><strong>Validation scope:</strong> {limitation}</p>)}
      <p className="muted">{new Date(run.startedAt).toLocaleString()} · {run.head.slice(0, 8)} · {run.environmentUrl}</p>
      {run.phase === 'reviewing' && <p>Awaiting independent visual and recovery evidence review. Evidence hash: {run.evidenceHash}</p>}
      {run.health && <p>Post-release health: <strong>{run.health.status}</strong>{run.health.error && ` — ${run.health.error}`} {run.phase === 'complete' && <button className="btn btn-ghost" disabled={busy || data.running || !data.policy?.enabled} onClick={() => void action(() => api.monitorDelivery(run.repoId, run.id))}>Check health now</button>}</p>}
      {run.previousRunId && <p>Previous verified deployment: {run.previousRunId}</p>}
      {run.recovery && <p>Recovery runbook and rehearsal evidence retained. Package SHA-256: {run.recovery.packageSha256}</p>}
      {run.error && <p role="alert">{run.error}</p>}
      {run.appUrls.map((url) => <p key={url}><a href={url} target="_blank" rel="noreferrer">Open deployed solution</a></p>)}
      {run.evidence.length > 0 && <details><summary>Verification evidence</summary><ul>{run.evidence.map((file) => <li key={file}><a href={`/api/delivery/runs/${run.id}/evidence?file=${encodeURIComponent(file)}`}>{file}</a></li>)}</ul></details>}
      <details><summary>Delivery stages</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{run.log.join('\n')}</pre></details>
    </section>)}
  </Panel>;
}
