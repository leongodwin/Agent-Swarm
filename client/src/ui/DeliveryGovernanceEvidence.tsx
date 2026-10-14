import {useState} from 'react';
import type {DeliveryRun} from '../../../shared/delivery';
import {api} from '../api';
import {useResource} from '../useResource';

const phases={build:'Build',test:'Test',import:'Import','post-deploy':'Post-deployment',verify:'Verification',health:'Health'};
const outcomes={'clear':'Recorded clear','blocked':'Recorded blocked','unavailable':'Recorded unavailable','not-recorded':'Not recorded','evidence-unavailable':'Evidence unavailable'};
export function DeliveryGovernanceEvidence({run}:{run:DeliveryRun}){
  const [open,setOpen]=useState(false);
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Governance by delivery stage</summary>{open&&<Content run={run}/>}</details>;
}
function Content({run}:{run:DeliveryRun}){
  const key=JSON.stringify([run.id,run.head,run.releaseId,run.environmentUrl,run.evidence,run.health?.governanceEvidence]);
  const resource=useResource(key,()=>api.governanceEvidence(run.id));
  return <section aria-label="Delivery governance history">
    <p>These are historical decisions. Current execution authority is unverified here; every new stage must run fresh checks.</p>
    {resource.error?<p role="alert">Governance evidence unavailable: {resource.error}</p>:resource.loading?<p role="status">Loading recorded governance decisions…</p>:resource.value&&<ul>{resource.value.stages.map(stage=><li key={stage.phase}>
      <strong>{phases[stage.phase]}: {outcomes[stage.status]}</strong>{stage.checkedAt&&<> · {new Date(stage.checkedAt).toLocaleString()}</>}
      <ul>{stage.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>
      {stage.artifactSha256&&<p>Recorded package digest: <code>{stage.artifactSha256}</code></p>}
      {stage.settingsSha256&&<p>Recorded settings digest: <code>{stage.settingsSha256}</code></p>}
    </li>)}</ul>}
    <button className="btn btn-ghost" disabled={resource.loading} onClick={()=>resource.refresh()}>Refresh governance history</button>
  </section>;
}
