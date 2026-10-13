import {useState} from 'react';
import {useStore} from '../store';
import {useResource} from '../useResource';
import {api} from '../api';
function History({repo}:{repo:string}){
  const history=useResource('workflow-reliability:'+repo,()=>api.workflowReliability(repo));const value=history.value;
  return <><button className="btn btn-small" onClick={history.refresh} disabled={history.loading}>{history.loading?'Reading history…':'Refresh CI history'}</button>
    {history.error?<p role="alert">History unavailable: {history.error}</p>:value?<>
      <p>GitHub Actions attempt success: {value.successPercent===null?'unverified':value.successPercent.toFixed(4)+'%'} · target {value.targetPercent}%</p>
      {value.status==='observed'&&<p>{value.completed} completed · {value.successful} successful · {value.unsuccessful} unsuccessful · {value.active} active · {value.rerunAttempts} additional attempts</p>}
      {value.status==='observed'&&<p>Observed <time dateTime={value.observedAt}>{new Date(value.observedAt).toLocaleString()}</time> · {value.observedMeetsTarget===null?'No completed attempts':value.observedMeetsTarget?'Observed window at or above target':'Observed window below target'}</p>}
      <p className="muted small">{value.reason}</p><p className="muted small">Runs created {new Date(value.window.from).toLocaleDateString()} through {new Date(value.window.to).toLocaleDateString()}. Window data is not release approval.</p>
      {!!value.failures.length&&<ul>{value.failures.map(run=><li key={run.runId+':'+run.attempt}><a href={run.url} target="_blank" rel="noreferrer">{run.name} · attempt {run.attempt}</a> · {run.conclusion}</li>)}</ul>}
    </>:<p>Workflow history has not been observed.</p>}</>;
}
export function WorkflowReliabilityPanel(){
  const repos=useStore(state=>state.repos);const [selected,setSelected]=useState('');const repo=repos.find(item=>item.id===selected)??repos[0];
  return <div className="card" aria-label="CI reliability history"><strong>CI reliability history</strong>{repo?<><p><label>Repository <select aria-label="Reliability repository" value={repo.id} onChange={event=>setSelected(event.target.value)}>{repos.map(item=><option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label></p><History key={repo.id} repo={repo.id}/></>:<p>Connect a repository to inspect authenticated workflow history.</p>}</div>;
}
