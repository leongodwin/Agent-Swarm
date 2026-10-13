import {useEffect,useRef,useState} from 'react';
import {useStore} from '../store';import {useResource} from '../useResource';import {api} from '../api';
function History({repo}:{repo:string}){
  const resource=useResource('delivery-attempt-history:'+repo,()=>api.delivery(repo)),current=useRef(resource);current.current=resource;
  useEffect(()=>{const timer=setInterval(()=>{if(!current.current.loading)current.current.refresh();},5000);return()=>clearInterval(timer);},[]);
  const value=resource.value?.attemptHistory;
  return <><button className="btn btn-small" onClick={resource.refresh} disabled={resource.loading}>Refresh delivery history</button>
    {resource.error?<p role="alert">Delivery history unavailable: {resource.error}</p>:value?<>
      <p>Complete 30-day delivery rate: {value.successPercent===null?'unverified':value.successPercent.toFixed(4)+'%'} · target {value.targetPercent}%</p>
      <p>Recorded subset: {value.recorded.completed} completed · {value.recorded.successful} successful · {value.recorded.unsuccessful} unsuccessful · {value.recorded.active} active · {value.recorded.awaitingReview} awaiting QA review</p>
      <p className="small">Collection began {value.coverageStartedAt?new Date(value.coverageStartedAt).toLocaleString():'unknown'} · {value.legacyRunCount} legacy runs with unknown attempt counts</p>
      <p className="muted small">{value.reason} A successful attempt means acceptance for its declared release scope.</p>
      {!!value.recent.length&&<div style={{overflowX:'auto'}}><table><caption>Recent retained delivery attempts</caption><thead><tr><th>Attempt</th><th>State</th><th>Release</th><th>Acceptance scope</th><th>Started</th></tr></thead><tbody>{value.recent.map(row=><tr key={row.id}><td>{row.id.slice(0,8)}</td><td>{row.status}{row.reason&&` · ${row.reason}`}</td><td>{row.releaseId}</td><td>{row.acceptanceProfile}</td><td><time dateTime={row.startedAt}>{new Date(row.startedAt).toLocaleString()}</time></td></tr>)}</tbody></table></div>}
    </>:<p>Delivery attempt history has not been observed.</p>}</>;
}
export function DeliveryAttemptPanel(){
  const repos=useStore(state=>state.repos),[selected,setSelected]=useState(''),repo=repos.find(row=>row.id===selected)??repos[0];
  return <div className="card" aria-label="Delivery attempt history"><strong>Delivery attempt history</strong>{repo?<><p><label>Repository <select aria-label="Delivery history repository" value={repo.id} onChange={event=>setSelected(event.target.value)}>{repos.map(row=><option key={row.id} value={row.id}>{row.fullName}</option>)}</select></label></p><History key={repo.id} repo={repo.id}/></>:<p>Connect a repository to inspect delivery history.</p>}</div>;
}
