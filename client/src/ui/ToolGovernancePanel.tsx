import { useEffect, useRef } from 'react';
import { api } from '../api';
import { useResource } from '../useResource';
import { useStore } from '../store';
import {WorkflowReliabilityPanel} from './WorkflowReliabilityPanel';

export function ToolGovernancePanel() {
  const resource = useResource('office-tool-governance', api.toolGovernance);
  const policies = useResource('office-tenant-policy', api.tenantDlp);
  const policyCurrent = useRef(policies); policyCurrent.current = policies;
  const current = useRef(resource); current.current = resource;
  const agents = useStore((state) => state.agents);
  const sessions=useStore(state=>state.sessionUsage);
  useEffect(() => { const timer=setInterval(() => { if (!current.current.loading) current.current.refresh(); },5000); return () => clearInterval(timer); },[]);
  useEffect(() => { const timer=setInterval(() => { if (!policyCurrent.current.loading) policyCurrent.current.refresh(); },5000); return () => clearInterval(timer); },[]);
  const view=resource.value;
  return <section aria-label="Operations and tool audit">
    <div className="row"><h3>Operations &amp; tool audit</h3><span className="spacer" /><button className="btn btn-small" onClick={resource.refresh} disabled={resource.loading}>Refresh audit</button></div>
    <p className="muted small">Recorded request safeguards. These counts cover observed checkpoints, not all tool calls or verified tenant compliance.</p>
    <WorkflowReliabilityPanel/>
    {sessions&&<div className="card" aria-label="Shared session budget"><strong>Shared session budget</strong><p>Occupied slots: {sessions.used} · limit {sessions.limit||'unlimited'} · {sessions.agentSessions} coding-agent sessions</p>{sessions.blockedReason&&<p role="alert">Session capacity is unverified: {sessions.blockedReason}</p>}<ul>{sessions.auxiliary.map(item=><li key={item.jobId}>Architecture {item.jobId} · {item.repoId} · {item.state}</li>)}{sessions.cleanup?.map(item=><li key={item.id}>Runtime cleanup · {agents[item.agentId]?.name??(item.agentId||'unknown worker')} · {item.cli} · PID {item.pid||'pending'} · {item.state}</li>)}</ul><p className="muted small">Stopping runtimes keep capacity quarantined until native root exit is acknowledged. These counts do not certify descendant termination or cross-machine capacity.</p></div>}
    <div className="card" aria-label="Tenant policy inventory">
      <strong>Standard tenant policy inventory</strong>
      {policies.error ? <p role="alert">Policy inventory unavailable: {policies.error}</p> : policies.value ? <>
        <p>Status: {policies.value.status}{policies.value.policyCount !== undefined && ` · ${policies.value.policyCount} policies in the saved observation`}</p>
        {policies.value.caller && <p className="small">{policies.value.caller} · {policies.value.tenantId}</p>}
        {policies.value.observedAt && <p className="small">Observed <time dateTime={policies.value.observedAt}>{new Date(policies.value.observedAt).toLocaleString()}</time></p>}
        <p className="muted small">{policies.value.reason}. Inventory alone does not verify compliance.</p>
      </> : <p role="status">Loading policy observation…</p>}
    </div>
    {resource.loading && <p role="status">Loading tool audit…</p>}
    {resource.error && <p role="alert">Audit unavailable: {resource.error}</p>}
    {view && <>
      {view.unavailableReason && <p role="alert">Execution blocked: {view.unavailableReason}</p>}
      <div className="card"><dl>
        <dt>Checkpoints recorded</dt><dd>{view.evaluated}</dd>
        <dt>Requests blocked by local safeguards</dt><dd>{view.blocked}</dd>
        <dt>Checks unavailable</dt><dd>{view.unavailable}</dd>
        <dt>Tenant policy verification</dt><dd>Not verified</dd>
      </dl></div>
      {!view.recent.length ? <p>No tool checkpoints recorded yet. This is not evidence of compliance.</p> : <div style={{overflowX:'auto'}}><table>
        <caption>Latest recorded tool decisions</caption>
        <thead><tr><th scope="col">Time</th><th scope="col">Agent</th><th scope="col">Tool</th><th scope="col">Outcome</th><th scope="col">Reason</th></tr></thead>
        <tbody>{[...view.recent].reverse().slice(0,20).map((entry)=><tr key={entry.id}>
          <td><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time></td>
          <td>{agents[entry.actor]?.name ?? entry.actor}<div className="muted small">{entry.runtime} · {entry.source}</div></td>
          <td style={{overflowWrap:'anywhere'}}>{entry.tool}</td><td>{entry.status}</td><td>{entry.reason}</td>
        </tr>)}</tbody>
      </table></div>}
      <p className="muted small">Tool payloads are not stored. The audit retains request hashes and the safeguard version. OpenCode, GitHub Copilot and untrusted hooks are not certified by this feed.</p>
    </>}
  </section>;
}
