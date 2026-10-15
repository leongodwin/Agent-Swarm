import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {useStore} from '../store';
import {discoveryAreas} from '../../../shared/deliveryRecord';

type View=Awaited<ReturnType<typeof api.deliveryRecord>>;
export function DeliveryPlanPanel({initialRepo}:{initialRepo?:string}) {
  const repos=useStore(state=>state.repos),agents=useStore(state=>state.agents);
  const [repoId,setRepoId]=useState(initialRepo??repos[0]?.id??'');
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const epoch=useRef(0);
  useEffect(()=>{if(!repos.some(repo=>repo.id===repoId))setRepoId(repos[0]?.id??'');},[repos,repoId]);
  const refresh=async()=>{
    const ticket=++epoch.current;setBusy(true);setError('');setView(null);
    try{const data=await api.deliveryRecord(repoId);if(ticket===epoch.current)setView(data);}
    catch{if(ticket===epoch.current)setError('Delivery planning is unavailable. Refresh after storage or connection recovery; previous approval is not assumed.');}
    finally{if(ticket===epoch.current)setBusy(false);}
  };
  useEffect(()=>{if(repoId)void refresh();return()=>{epoch.current++;};},[repoId]);
  const act=async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();useStore.getState().pushToast('info','Request queued. Refresh to see the team’s progress.');}catch{/* API displays the specific refusal. */}finally{setBusy(false);}};
  const record=view?.record,content=record?.content;
  const name=(id:string)=>agents[id]?.name??id;
  return <section aria-label="Shared delivery plan">
    <h3>Brief to deployed solution</h3>
    <p>Discovery → independent design review → first deployed journey → wider implementation.</p>
    <div className="row wrap"><label className="row wrap" style={{maxWidth:'100%'}}>Project <select style={{maxWidth:'100%',minWidth:0}} value={repoId} onChange={e=>setRepoId(e.target.value)}>{repos.map(repo=><option key={repo.id} value={repo.id}>{repo.fullName}</option>)}</select></label>
      <button className="btn btn-small" disabled={!repoId||busy} onClick={()=>void refresh()}>Refresh plan</button>
      <button className="btn btn-small" disabled={!repoId||busy||view?.demo||!view} onClick={()=>void act(()=>api.planFloor(repoId))}>Ask CEO to plan discovery</button>
    </div>
    {busy&&<p role="status">Loading or requesting team work…</p>}{error&&<p role="alert">{error}</p>}
    {view?.demo&&<p>Demo mode. Planning does not inspect or change a real project.</p>}
    {view&&<p><strong>Current stage: {view.phase.replaceAll('-',' ')}</strong>{record&&` · revision ${record.revision}`}</p>}
    {!!view?.blockers.length&&<section aria-label="Discovery blockers"><h4>Before the team can proceed</h4><ul>{view.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></section>}
    {content&&<>
      <h4>Outcome and scope</h4><p>{content.outcome}</p><p><strong>Success measure:</strong> {content.successMeasure}</p>
      <p><strong>Delivery owner:</strong> {name(content.owner)} · <strong>Independent QA:</strong> {name(content.qaOwner)}</p>
      <p><strong>Users:</strong> {content.users.join('; ')}</p><p><strong>Target:</strong> {content.environmentUrl??'Not approved yet'}</p>
      <details><summary>Original brief, scope and exclusions</summary><p>{content.brief}</p><ul>{content.scope.map((item,index)=><li key={index}>{item}</li>)}</ul><p>Excluded: {content.exclusions.join('; ')||'None declared'}</p></details>
      {content.governanceProfile&&<section aria-label="Tenant governance baseline"><h4>Governance for this tenant</h4><p>{content.governanceProfile.audience}</p><p>Licences, enabled features and verified controls are assessed separately. Optional features do not require an upgrade to proceed.</p><details><summary>Observed licences and assignment scope</summary>{content.governanceProfile.subscriptions.map((subscription,index)=><p key={index}>{subscription.product} · {subscription.state} · {subscription.assignmentScope}</p>)}</details>{content.governanceProfile.controls.map(control=><div className="card" key={control.id}><strong>{control.name} · {control.requirement.replaceAll('-',' ')}</strong><p>{control.availability} · {control.delivery} · {control.verification}</p><p>{control.rationale}</p><p>Owner: {name(control.owner)} · Scope: {control.scope}</p></div>)}</section>}
      <h4>Discovery evidence</h4><p>Observations are reported by the team. References and hashes identify evidence; independent QA must challenge the conclusions.</p>
      {discoveryAreas.map(area=><details key={area}><summary>{area.replaceAll('-',' ')} · {content.findings.filter(f=>f.area===area&&f.status==='observed').length} observed</summary>
        {content.findings.filter(f=>f.area===area).map(f=><div className="card" key={f.id}><strong>{f.status} · {f.conclusion??'unknown'}{f.critical?' · critical':''}</strong><p>{f.statement}</p><p>Owner: {name(f.owner)} · Next action: {f.remedy}</p>{f.evidence.map((e,index)=><p className="small" key={index} style={{overflowWrap:'anywhere'}}>{e.reference}<br/>Observed {e.observedAt} · expires {e.expiresAt}<br/>SHA-256: {e.sha256}</p>)}</div>)}
      </details>)}
      <h4>Requirements and linked work</h4>{content.requirements.map(req=><div className="card" key={req.id}><strong>{req.id}: {req.description}</strong><p>Acceptance: {req.acceptance}</p><p>Issues: {content.tasks.filter(task=>task.requirementIds.includes(req.id)).map(task=>`#${task.issue} (${task.stage})`).join(', ')||'No task linked yet'}</p></div>)}
      <h4>Design review</h4><p>{record.designReview?`${record.designReview.decision} by ${name(record.designReview.reviewer)}`:'Awaiting independent review of discovery and design.'}</p>{record.designReview&&<p>{record.designReview.notes}</p>}
      <button className="btn btn-small" disabled={busy||view?.demo||!!record.sliceReceipt} onClick={()=>void act(()=>api.reviewDeliveryRecord(repoId))}>Request independent design review</button>
      <h4>First deployed journey</h4><p>{content.slice.description}</p><ul>{content.slice.acceptanceCriteria.map((item,index)=><li key={index}>{item}</li>)}</ul>
      <p>{record.sliceReceipt?`Accepted from deployment ${record.sliceReceipt.runId}.`:'Wider implementation remains held until deployment and independent acceptance are recorded.'}</p>
      <details><summary>Shared contracts and version</summary>{content.contracts.map(contract=><p key={contract.id}><strong>{contract.id}</strong> · {name(contract.owner)} · {contract.description}</p>)}<p style={{overflowWrap:'anywhere'}}>Record {record.id} · {record.sha256}<br/>Discovery source: {content.sourceCommit??'Not inspected yet'}</p></details>
    </>}
  </section>;
}
