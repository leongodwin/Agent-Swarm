import {api} from '../api';
import {useResource} from '../useResource';
import {useState} from 'react';
import type {SchemaDiagnostic} from '../../../shared/healthEvidence';

const labels={decision:'Lifecycle decision',package:'Package inventory',schema:'Declared schema observation','advanced-policy':'Environment policy assignments','connector-catalogue':'Requested connector catalogue'};
const stages:Record<SchemaDiagnostic['stage'],string>={contract:'Contract validation','initial-identity':'Initial target identity','resource-contracts':'Package resource contracts',migration:'Migration compatibility',columns:'Column validation',structure:'Relationships and keys','final-identity':'Final target identity',evidence:'Evidence validation',complete:'Completed declared checks'};
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
      {resource.value.schema&&<section aria-label="Schema check diagnostics">
        {resource.value.schema.status==='evidence-unavailable'?<p>Schema diagnostic evidence could not be verified for this decision.</p>:<>
          <p>Declared schema: <strong>{resource.value.schema.status}</strong> · {new Date(resource.value.schema.checkedAt).toLocaleString()}</p>
          {resource.value.schema.diagnostic&&<p>{stages[resource.value.schema.diagnostic.stage]} · {resource.value.schema.diagnostic.failure==='none'?'passed':resource.value.schema.diagnostic.failure} · {(resource.value.schema.diagnostic.elapsedMs/1000).toFixed(2)}s · {resource.value.schema.diagnostic.nativeCommands} native {resource.value.schema.diagnostic.nativeCommands===1?'command':'commands'} · {resource.value.schema.diagnostic.metadataReads} metadata {resource.value.schema.diagnostic.metadataReads===1?'read':'reads'}</p>}
          <p>{resource.value.schema.reason}</p>
        </>}
      </section>}
      <ul>{resource.value.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
      <ul>{resource.value.files.map(item=><li key={item.file}><a href={`/api/delivery/runs/${encodeURIComponent(run)}/health-evidence?file=${encodeURIComponent(item.file)}`}>{labels[item.kind]}</a></li>)}</ul>
    </>}
    <button className="btn btn-ghost" disabled={resource.loading} onClick={()=>resource.refresh()}>Refresh health evidence</button>
  </>;
}
