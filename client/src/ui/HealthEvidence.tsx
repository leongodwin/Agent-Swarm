import {api} from '../api';
import {useResource} from '../useResource';
import {useState} from 'react';

const labels={decision:'Lifecycle decision',package:'Package inventory',schema:'Declared schema observation','advanced-policy':'Environment policy assignments'};
export function HealthEvidence({run,decision}:{run:string;decision:string}){
  const [open,setOpen]=useState(false);
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Latest health governance evidence</summary>
    {open&&<HealthEvidenceContent run={run} decision={decision}/>}
  </details>;
}
function HealthEvidenceContent({run,decision}:{run:string;decision:string}){
  const resource=useResource(`health-evidence:${run}:${decision}`,()=>api.healthEvidence(run));
  return <>
    {resource.error&&<p role="alert">{resource.error}</p>}
    {!resource.value&&!resource.error&&<p>Loading current health evidence…</p>}
    {resource.value&&<>
      <p>Lifecycle decision: <strong>{resource.value.status}</strong> · {new Date(resource.value.checkedAt).toLocaleString()}</p>
      <p>Policy and schema observations show their own validation scope. Reading this evidence does not grant deployment approval.</p>
      <ul>{resource.value.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
      <ul>{resource.value.files.map(item=><li key={item.file}><a href={`/api/delivery/runs/${encodeURIComponent(run)}/health-evidence?file=${encodeURIComponent(item.file)}`}>{labels[item.kind]}</a></li>)}</ul>
    </>}
    <button className="btn btn-ghost" disabled={resource.loading} onClick={()=>resource.refresh()}>Refresh health evidence</button>
  </>;
}
