import {useState} from 'react';
import {useStore} from '../store';
import {useResource} from '../useResource';
import {api} from '../api';
function Report({repo}:{repo:string}){
 const resource=useResource('execution-efficiency:'+repo,()=>api.efficiency(repo)),value=resource.value;
 const n=(value:number|null)=>value===null?'unknown':value.toLocaleString();
 return <><button className="btn btn-small" onClick={resource.refresh} disabled={resource.loading}>Refresh execution evidence</button>{resource.error?<p role="alert">Execution evidence unavailable: {resource.error}</p>:value?.availability==='unavailable'?<p role="alert">{value.reason}</p>:value?<>
 <p>{value.counts.reserved} reserved attempts · {value.counts.launched} launched · {value.counts.reportedSuccess} model-reported successes · {value.counts.acceptedCurrent} currently accepted merged tasks</p>
 <p>Measured subset: {value.usage.measuredAttempts} attempts · {value.usage.unknownAttempts} unknown usage · input {n(value.usage.inputTokens)} · output {n(value.usage.outputTokens)} · USD {n(value.usage.costUsd)}</p>
 <p>Tokens per measured accepted task: {n(value.usage.tokensPerAcceptedTask)} · USD per measured accepted task: {n(value.usage.costPerAcceptedTask)} · {value.counts.acceptedUnknownUsage} accepted tasks with unknown usage</p>
 <p>{value.reason}</p><p>30-day window completeness: {value.completeWindow?'retained window covered':'partial collection'} · collection began {value.collectionStartedAt??'unknown'}</p>
 {value.retryHolds.map((hold,i)=><p key={i}>Automatic retry hold · issue {hold.issue??'unassigned'} · {hold.role} · {hold.attempts} reservations</p>)}
 <ul>{value.limitations.map(line=><li key={line}>{line}</li>)}</ul><a href={`/api/repos/${encodeURIComponent(repo)}/efficiency/export`} target="_blank" rel="noreferrer">Export retained execution metadata</a>
 </>:<p>Execution evidence has not been observed.</p>}</>;
}
export function ExecutionEfficiencyPanel(){const repos=useStore(s=>s.repos),[selected,setSelected]=useState(''),repo=repos.find(r=>r.id===selected)??repos[0];return <div className="card" aria-label="Execution efficiency"><strong>Execution efficiency</strong>{repo?<><p><label>Execution repository <select value={repo.id} onChange={e=>setSelected(e.target.value)}>{repos.map(r=><option key={r.id} value={r.id}>{r.fullName}</option>)}</select></label></p><Report key={repo.id} repo={repo.id}/></>:<p>Connect a repository to inspect execution evidence.</p>}</div>;}
