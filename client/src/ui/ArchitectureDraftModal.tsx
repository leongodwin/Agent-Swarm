import { useEffect, useMemo, useState } from 'react';
import { Panel } from './Overlays';
import { useStore } from '../store';
import { api } from '../api';
import { generateHldContent, type HldResult, type HldComponent } from '../../../shared/hld';
const views = [['overview','Requirements & gaps'],['plan','Implementation plan'],['diagrams','Diagram scope'],['document','Full document']] as const;

export function ArchitectureDraftModal({repoId}: {repoId?: string}) {
  const repos = useStore(state => state.repos);
  const repo = repos.find(item => item.id === repoId) ?? repos[0];
  const pushToast = useStore(state => state.pushToast);
  const [activeTab,setActiveTab] = useState<'overview'|'plan'|'diagrams'|'document'>('overview');
  const [saving,setSaving] = useState(false);
  const [components,setComponents] = useState<HldComponent[]>([]);
  const [title,setTitle] = useState('');
  const [platform,setPlatform] = useState('');
  const [details,setDetails] = useState('');
  const [deliverables,setDeliverables] = useState('');
  const declaredDeliverables = deliverables.split('\n').map(item=>item.trim()).filter(Boolean);
  const deliverableError = declaredDeliverables.length>100 ? 'Use at most 100 deliverables.' : declaredDeliverables.some(item=>item.length>500) ? 'Each deliverable must be 500 characters or fewer.' : '';
  useEffect(() => {setComponents([]);setTitle('');setPlatform('');setDetails('');setDeliverables('');},[repo?.id]);
  const input = useMemo(() => ({solutionName:repo?.fullName || 'Untitled solution',
    problemContext:repo?.mission || 'Requirements have not been supplied. Record the project mission before architecture synthesis.',
    tenantName:repo?.targetTenancy?.tenantName, components}), [repo,components]);
  const inputKey = JSON.stringify(input);
  const addComponent = () => {
    if (!title.trim() || !platform.trim() || components.length >= 100 || deliverableError) return;
    setComponents(current => [...current,{title:title.trim(),badge:platform.trim(),role:'Owner not assigned',
      details:details.trim() || 'Scope needs design.',deliverables:declaredDeliverables}]);
    setTitle('');setPlatform('');setDetails('');setDeliverables('');
  };
  const generated = useMemo(() => generateHldContent(input), [inputKey]);
  const [saved,setSaved] = useState<{key:string;result:HldResult}|null>(null);
  const draft = saved?.key===inputKey ? saved.result : generated;
  const save = async () => {
    if (!repo || saving) return;
    setSaving(true);
    try {
      const result = await api.generateHld<HldResult>({...input,repoId:repo.id});
      if (!result.savedFilePath) throw new Error('The server did not confirm a saved draft');
      setSaved({key:inputKey,result});
      pushToast('success',`Draft saved to ${result.savedFilePath}`);
    } catch (error) {pushToast('error',error instanceof Error ? error.message : 'Could not save draft');}
    finally {setSaving(false);}
  };
  const copy = async () => {
    try {await navigator.clipboard.writeText(draft.markdownContent);pushToast('success','Architecture draft copied');}
    catch {pushToast('error','Could not copy architecture draft');}
  };
  return <Panel title="Architecture draft & implementation plan" wide accent="#7c3aed" className="hld-modal">
    <div className="row" style={{flexWrap:'wrap',gap:8}}>
      <strong>{draft.solutionName}</strong><span className="chip">Draft · unreviewed</span><span className="chip">{draft.missingEvidence.length} evidence gaps</span><span className="spacer"/>
      <button className="btn btn-small" onClick={() => void copy()}>Copy Markdown</button>
      <button className="btn btn-small" disabled={!repo || saving} onClick={() => void save()}>{saving?'Saving…':'Save draft to repository'}</button>
    </div>
    <p className="muted small">Requirements template. Model synthesis, architecture approval and tenant verification are pending.</p>
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
