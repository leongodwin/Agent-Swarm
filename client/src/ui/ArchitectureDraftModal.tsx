import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';
import { api } from '../api';
import { generateHldContent, type HldResult, type HldComponent } from '../../../shared/hld';
import type {HldArtifact} from '../../../shared/hldArtifact';
import type {SynthesisJob,SynthesisSummary} from '../../../shared/hldSynthesis';
const views = [['overview','Requirements & gaps'],['plan','Implementation plan'],['diagrams','Diagram scope'],['document','Full document']] as const;

export function ArchitectureDraftModal({repoId}: {repoId?: string}) {
  const repos = useStore(state => state.repos);
  const repo = repoId?repos.find(item => item.id === repoId):repos[0];
  const pushToast = useStore(state => state.pushToast);
  const [activeTab,setActiveTab] = useState<'overview'|'plan'|'diagrams'|'document'>('overview');
  const [saving,setSaving] = useState<'save'|'load'|'synthesize'|null>(null);
  const [job,setJob]=useState<SynthesisJob|null>(null);
  const [summary,setSummary]=useState<SynthesisSummary|null>(null);
  const [modelAvailable,setModelAvailable]=useState(false);
  const [telemetryError,setTelemetryError]=useState('');
  const activeJob=!!job&&(job.runtimeCleanup==='awaiting-completion'||!['completed','blocked','failed','cancelled'].includes(job.status));
  const [loaded,setLoaded]=useState<{repoId:string;input:HldArtifact['input']}|null>(null);
  const scope=useRef(repo?.id),epoch=useRef(0),currentInput=useRef('');scope.current=repo?.id;
  const [components,setComponents] = useState<HldComponent[]>([]);
  useEffect(()=>{
    setJob(null);setSummary(null);setModelAvailable(false);setTelemetryError('');if(!repo)return;let cancelled=false;
    const refresh=async()=>{try{const data=await api.hldJobs<{jobs:SynthesisJob[];summary?:SynthesisSummary;available:boolean;unavailableReason?:string}>(repo.id);if(!cancelled){setJob(data.jobs[0]??null);setSummary(data.summary??null);setModelAvailable(data.available);setTelemetryError(data.unavailableReason??'');}}catch{if(!cancelled){setSummary(null);setTelemetryError('Synthesis telemetry is unavailable; its last status is unverified until refresh succeeds.');}}};
    void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{cancelled=true;clearInterval(timer);};
  },[repo?.id]);
  const [title,setTitle] = useState('');
  const [platform,setPlatform] = useState('');
  const [details,setDetails] = useState('');
  const [deliverables,setDeliverables] = useState('');
  const declaredDeliverables = deliverables.split('\n').map(item=>item.trim()).filter(Boolean);
  const deliverableError = declaredDeliverables.length>100 ? 'Use at most 100 deliverables.' : declaredDeliverables.some(item=>item.length>500) ? 'Each deliverable must be 500 characters or fewer.' : '';
  useEffect(() => {epoch.current++;setLoaded(null);setSaved(null);setSaving(null);setComponents([]);setTitle('');setPlatform('');setDetails('');setDeliverables('');},[repo?.id]);
  const input = useMemo(() => {const stored=loaded?.repoId===repo?.id?loaded?.input:undefined;return {solutionName:stored?.solutionName??repo?.fullName??'Untitled solution',
    problemContext:stored?stored.problemContext:repo?.mission||'Requirements have not been supplied. Record the project mission before architecture synthesis.',
    tenantName:stored?stored.tenantName:repo?.targetTenancy?.tenantName, components};}, [repo,components,loaded]);
  const inputKey = JSON.stringify(input);
  currentInput.current=inputKey;
  const addComponent = () => {
    if (!title.trim() || !platform.trim() || components.length >= 100 || deliverableError) return;
    setComponents(current => [...current,{title:title.trim(),badge:platform.trim(),role:'Owner not assigned',
      details:details.trim() || 'Scope needs design.',deliverables:declaredDeliverables}]);
    setTitle('');setPlatform('');setDetails('');setDeliverables('');
  };
  const generated = useMemo(() => generateHldContent(input), [inputKey]);
  const [saved,setSaved] = useState<{key:string;result:HldResult}|null>(null);
  const draft = saved?.key===inputKey ? saved.result : generated;
  const synthesize=async()=>{
    if(!repo||saving||activeJob)return;const ticket=++epoch.current,id=repo.id;setSaving('synthesize');
    try{const data=await api.synthesizeHld<{job:SynthesisJob}>({...input,repoId:id});if(ticket===epoch.current&&scope.current===id)setJob(data.job);}
    catch(error){if(ticket===epoch.current&&scope.current===id)pushToast('error',error instanceof Error?error.message:'Could not start architecture synthesis');}
    finally{if(ticket===epoch.current&&scope.current===id)setSaving(null);}
  };
  const loadModel=async()=>{
    if(!repo||!job||job.status!=='completed'||saving)return;const ticket=++epoch.current,id=repo.id,key=inputKey;setSaving('load');
    try{const {artifact}=await api.hldJobResult<{artifact:HldArtifact}>(id,job.id);if(ticket!==epoch.current||scope.current!==id)return;
      if(currentInput.current!==key)throw new Error('Requirements changed while loading the model draft; retry to load its snapshot');
      setLoaded({repoId:id,input:artifact.input});setComponents(artifact.input.components);setSaved({key:JSON.stringify(artifact.input),result:{...artifact.result,artifactSha256:artifact.sha256}});
    }catch(error){if(ticket===epoch.current&&scope.current===id)pushToast('error',error instanceof Error?error.message:'Could not load model draft');}
    finally{if(ticket===epoch.current&&scope.current===id)setSaving(null);}
  };
  const cancel=async()=>{
    if(!repo||!job)return;const id=repo.id,jobId=job.id;
    try{const data=await api.cancelHldJob<{job:SynthesisJob}>(id,jobId);if(scope.current===id)setJob(data.job);}catch{/* API displays the failure; keep the last observed job status. */}
  };
  const save = async () => {
    if (!repo || saving) return;
    const ticket=++epoch.current,id=repo.id;setSaving('save');
    try {
      const result = await api.generateHld<HldResult>({...input,repoId:repo.id});
      if(ticket!==epoch.current||scope.current!==id)return;
      if (!result.savedFilePath) throw new Error('The server did not confirm a saved draft');
      setSaved({key:inputKey,result});
      pushToast('success',`Draft saved to ${result.savedFilePath}`);
    } catch (error) {if(ticket===epoch.current&&scope.current===id)pushToast('error',error instanceof Error ? error.message : 'Could not save draft');}
    finally {if(ticket===epoch.current&&scope.current===id)setSaving(null);}
  };
  const load=async()=>{
    if(!repo||saving)return;const ticket=++epoch.current,id=repo.id,key=inputKey;setSaving('load');
    try{
      const {artifact}=await api.latestHld<{artifact:HldArtifact|null}>(id);
      if(ticket!==epoch.current||scope.current!==id)return;
      if(currentInput.current!==key)throw new Error('Requirements changed while loading; retry to load the saved snapshot');
      if(!artifact){pushToast('info','No structured saved draft is available');return;}
      setLoaded({repoId:id,input:artifact.input});setComponents(artifact.input.components);
      setSaved({key:JSON.stringify(artifact.input),result:{...artifact.result,artifactSha256:artifact.sha256}});
      pushToast('success',`Loaded saved draft ${artifact.result.docId}`);
    }catch(error){if(ticket===epoch.current&&scope.current===id)pushToast('error',error instanceof Error?error.message:'Could not load draft');}
    finally{if(ticket===epoch.current&&scope.current===id)setSaving(null);}
  };
  const copy = async () => {
    try {await navigator.clipboard.writeText(draft.markdownContent);pushToast('success','Architecture draft copied');}
    catch {pushToast('error','Could not copy architecture draft');}
  };
  return <Panel title="Architecture draft & implementation plan" wide accent="#7c3aed" className="hld-modal">
    <div className="row" style={{flexWrap:'wrap',gap:8}}>
      <strong>{draft.solutionName}</strong><span className="chip">Draft · unreviewed</span><span className="chip">{draft.missingEvidence.length} evidence gaps</span><span className="spacer"/>
      <button className="btn btn-small" onClick={() => void copy()}>Copy Markdown</button>
      <button className="btn btn-small" disabled={!repo || !!saving} onClick={() => void load()}>{saving==='load'?'Loading…':'Load saved draft'}</button>
      <button className="btn btn-small" disabled={!repo || !!saving || activeJob} onClick={() => void save()}>{saving==='save'?'Saving…':'Save draft to repository'}</button>
      <button className="btn btn-small" disabled={!repo||!modelAvailable||!!saving||activeJob} onClick={()=>void synthesize()}>{saving==='synthesize'?'Starting…':'Synthesize with Codex'}</button>
    </div>
    <p className="muted small">{draft.generationMethod==='model-synthesis'?'Model-generated draft. Independent architecture approval and tenant verification are pending.':'Requirements template. Model synthesis, architecture approval and tenant verification are pending.'}</p>
    {telemetryError&&<p role="alert">{telemetryError}</p>}
    {summary&&<section aria-label="Synthesis retained history"><p><strong>Retained Codex synthesis history</strong> · complete 30-day completion rate: {summary.completeWindowCompletionPercent===null?'unverified':summary.completeWindowCompletionPercent.toFixed(2)+'%'}</p><p>Recorded subset: {summary.recorded.completed} completed · {summary.recorded.failed} failed · {summary.recorded.blocked} blocked · {summary.recorded.cancelled} cancelled · {summary.recorded.active} active · {summary.recorded.awaitingCleanup} awaiting cleanup</p><p>Successful draft timings ({summary.successfulDurationMs.count} samples): median {summary.successfulDurationMs.median===null?'unavailable':(summary.successfulDurationMs.median/1000).toFixed(2)+' seconds'} · p95 {summary.successfulDurationMs.p95===null?'unavailable':(summary.successfulDurationMs.p95/1000).toFixed(2)+' seconds'}</p><p className="muted small">Collection began {new Date(summary.coverageStartedAt).toLocaleString()} · {summary.recorded.legacyProviderJobs} legacy provider jobs excluded. {summary.reason}</p></section>}
    {summary?.durationCoverage&&<p>Timing coverage: {summary.durationCoverage.monotonic} monotonic observations · {summary.durationCoverage.wallClockOnly} wall-clock-only completions excluded from latency statistics.</p>}
    {job&&<section aria-label="Architecture synthesis telemetry"><p><strong>Model job: {job.status}</strong> · {Math.round((job.monotonicElapsedMs??job.elapsedMs??Math.max(0,Date.now()-job.startedAt))/1000)} seconds ({job.monotonicElapsedMs===undefined?'wall-clock estimate':'monotonic observation'}) · five-minute deadline</p>{job.error&&<p role="alert">{job.error}</p>}{job.runtimeCleanup==='awaiting-completion'&&['completed','failed','blocked','cancelled'].includes(job.status)&&<p role="status">Process cleanup is unverified. The session slot remains occupied; preserve the job records and verify process termination before recovery.</p>}<ol>{job.events.slice(-5).map((event,index)=><li key={`${event.at}-${index}`}>{event.text}</li>)}</ol>{activeJob&&!['completed','failed','blocked','cancelled'].includes(job.status)&&<button className="btn btn-small" onClick={()=>void cancel()}>Cancel synthesis</button>}{job.status==='completed'&&<button className="btn btn-small" disabled={!!saving||job.runtimeCleanup==='awaiting-completion'} onClick={()=>void loadModel()}>Load model-generated draft</button>}</section>}
    {loaded?.repoId===repo?.id&&<p className="muted small">Showing stored requirements. <button className="btn btn-small" disabled={!!saving} onClick={()=>{setLoaded(null);setSaved(null);}}>Use current project brief</button></p>}
    <div className="row" role="tablist" aria-label="Architecture draft views" style={{flexWrap:'wrap',gap:8}} onKeyDown={event=>{
      const current=views.findIndex(([id])=>id===activeTab);
      const next=event.key==='ArrowRight'?(current+1)%views.length:event.key==='ArrowLeft'?(current+views.length-1)%views.length:event.key==='Home'?0:event.key==='End'?views.length-1:null;
      if(next===null)return;event.preventDefault();const id=views[next][0];setActiveTab(id);document.getElementById(`hld-${id}-tab`)?.focus();
    }}>
      {views.map(([id,text]) =>
        <button key={id} id={`hld-${id}-tab`} className="btn btn-small" style={activeTab===id?{background:'#ede9fe',borderColor:'#7c3aed'}:undefined} role="tab" tabIndex={activeTab===id?0:-1} aria-selected={activeTab===id} aria-controls={`hld-${id}-panel`} onClick={() => setActiveTab(id)}>{text}</button>)}
    </div>
    <section id={`hld-${activeTab}-panel`} role="tabpanel" aria-labelledby={`hld-${activeTab}-tab`} style={{marginTop:14,maxHeight:'65vh',overflowY:'auto'}}>
      {activeTab==='overview' && <>
        <div className="card"><details open={input.problemContext.length<=600}><summary>Recorded project brief · review required</summary><p style={{whiteSpace:'pre-wrap'}}>{input.problemContext}</p></details>
          <p className="muted small">Tenant supplied: {input.tenantName || 'Not supplied'} · unverified</p></div>
        <div className="card"><h3>Declare component scope</h3><p className="muted small">Add the components your requirements call for. Ownership, schema, integrations and platform availability still need review.</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
            <label>Component title<input aria-label="Component title" value={title} maxLength={500} onChange={event=>setTitle(event.target.value)}/></label>
            <label>Platform or category<input aria-label="Platform or category" value={platform} maxLength={500} onChange={event=>setPlatform(event.target.value)}/></label>
          </div>
          <label>Functional scope<textarea aria-label="Functional scope" rows={2} value={details} maxLength={8000} onChange={event=>setDetails(event.target.value)}/></label>
          <label>Deliverables, one per line<textarea aria-label="Deliverables, one per line" rows={3} value={deliverables} maxLength={50000} onChange={event=>setDeliverables(event.target.value)}/></label>
          {deliverableError && <p role="alert">{deliverableError}</p>}
          <button className="btn btn-small" disabled={!title.trim() || !platform.trim() || components.length>=100 || !!deliverableError} onClick={addComponent}>Add component</button>
          {components.map((component,index)=><div className="row" key={index} style={{flexWrap:'wrap',marginTop:8}}><strong>{component.title}</strong><span className="chip">{component.badge}</span><span className="spacer"/>
            <button className="btn btn-small" aria-label={`Remove ${component.title}`} onClick={()=>setComponents(current=>current.filter((_,position)=>position!==index))}>Remove</button></div>)}
        </div>
        <div className="card"><h3>Evidence and decisions required</h3><ul>{draft.missingEvidence.map(item => <li key={item}>{item}</li>)}</ul></div>
      </>}
      {activeTab==='plan' && draft.implementationPlan.map(step => <div className="card" key={step.id}><h3>{step.title}</h3>
        <strong>Deliverables</strong><ul>{step.deliverables.map(item => <li key={item}>{item}</li>)}</ul>
        <strong>Acceptance</strong><ul>{step.acceptance.map(item => <li key={item}>{item}</li>)}</ul></div>)}
      {activeTab==='diagrams' && <><p>The topology groups declared components. Entity contracts, integration edges and workflow transitions still need design.</p>
        {Object.entries(draft.mermaidDiagrams).map(([name,source]) => <div className="card" key={name}><h3>{name==='erd'?'Data model':name==='sequence'?'Workflow':'Declared scope'}</h3>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{source}</pre></div>)}</>}
      {activeTab==='document' && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{draft.markdownContent}</pre>}
    </section>
  </Panel>;
}
