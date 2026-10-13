import {useEffect,useRef} from 'react';
import {api} from '../api';
import {useResource} from '../useResource';

export function OfficeRuntimePanel(){
  const resource=useResource('office-runtime',api.officeRuntime),current=useRef(resource);current.current=resource;
  useEffect(()=>{const timer=setInterval(()=>{if(!current.current.loading)current.current.refresh();},5000);return()=>clearInterval(timer);},[]);
  const view=resource.value,reload=view?.reload;
  return <div className="card" aria-label="Office runtime and reload">
    <div className="row"><strong>Office runtime</strong><span className="spacer"/><button className="btn btn-small" onClick={resource.refresh} disabled={resource.loading}>Refresh runtime</button></div>
    {resource.error?<p role="alert">Runtime unavailable: {resource.error}. Replacement readiness is unverified.</p>:view?<>
      <p>Server PID {view.pid} · {view.draining?'Maintenance drain preserved':'Accepting work'}</p>
      <p className="small">Started <time dateTime={view.startedAt}>{new Date(view.startedAt).toLocaleString()}</time></p>
      <p>Launcher reload: {reload?.supported?'Supported':'Unverified'} · {reload?.phase??'unavailable'}</p>
      {reload?.operationId&&<p className="small">Operation {reload.operationId} · previous PID {reload.sourcePid??'unknown'} · replacement PID {reload.targetPid??'not verified'}</p>}
      {reload?.reason&&<p role={reload.phase==='failed'?'alert':undefined}>{reload.reason}</p>}
      <p className="muted small">Reload requires an idle, drained office and its owning launcher. Ready means the replacement listener started; tenant delivery and authentication remain separately verified.</p>
    </>:<p role="status">Loading runtime…</p>}
  </div>;
}
