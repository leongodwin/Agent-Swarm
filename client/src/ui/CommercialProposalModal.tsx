import {useMemo,useState} from 'react';
import {Panel} from './Overlays';
import {useStore} from '../store';
import {api} from '../api';
import {generateProposal,proposalInputSchema,licenseScenarioSchema,type ProposalInput,type ProposalResult} from '../../../shared/proposals';
type LicenseInput=NonNullable<NonNullable<ProposalInput['commercial']>['licensing']>[number];
const numeric=(text:string)=>text.trim()===''?undefined:Number(text);
const lines=(text:string)=>text.split('\n').map(item=>item.trim()).filter(Boolean);

export function CommercialProposalModal(_props: {ideaId?:string}) {
  const pushToast=useStore(state=>state.pushToast),openOverlay=useStore(state=>state.openOverlay);
  const company=useStore(state=>state.settings.companyName);
  const [title,setTitle]=useState('Solution proposal');const [client,setClient]=useState(company||'Client not supplied');
  const [problem,setProblem]=useState('Requirements need confirmation.');const [industry,setIndustry]=useState('Not supplied');
  const [users,setUsers]=useState(''),[volume,setVolume]=useState(''),[channels,setChannels]=useState(''),[integrations,setIntegrations]=useState('');
  const [tier,setTier]=useState<ProposalInput['complianceTier']>('standard'),[currency,setCurrency]=useState<'GBP'|'USD'|'EUR'>('GBP');
  const [implementation,setImplementation]=useState(''),[operating,setOperating]=useState(''),[timeline,setTimeline]=useState(''),[minutes,setMinutes]=useState(''),[hourly,setHourly]=useState('');
  const [licenses,setLicenses]=useState<LicenseInput[]>([]);
  const [sku,setSku]=useState(''),[category,setCategory]=useState(''),[quantity,setQuantity]=useState(''),[unit,setUnit]=useState(''),[source,setSource]=useState('');
  const [tab,setTab]=useState<'scope'|'scenario'|'document'>('scope'),[busy,setBusy]=useState(false);
  const [serverResult,setServerResult]=useState<{key:string;result:ProposalResult}|null>(null);
  const raw={title,clientName:client,industry,problemStatement:problem,userCount:numeric(users)??null,monthlyTransactions:numeric(volume)??null,complianceTier:tier,targetChannels:lines(channels),integrationPoints:lines(integrations),
    commercial:{currency,licensing:licenses.length?licenses:undefined,implementationCost:numeric(implementation),monthlyOtherOperatingCost:numeric(operating),timelineWeeks:numeric(timeline),minutesSavedPerTransaction:numeric(minutes),hourlyCost:numeric(hourly)}};
  const key=JSON.stringify([raw,users,volume,implementation,operating,timeline,minutes,hourly]);
  const parsed=useMemo(()=>proposalInputSchema.safeParse(raw),[key]);
  const local=useMemo(()=>{if(!parsed.success)return null;try{return generateProposal(parsed.data);}catch{return null;}},[key]);
  const result=serverResult?.key===key?serverResult.result:local;
  const error=parsed.success?(local?'':'Scenario exceeds supported financial precision.'):parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ');
  const license=licenseScenarioSchema.safeParse({sku,category,quantity:numeric(quantity),unitPriceMonthly:numeric(unit),notes:source});
  const addLicense=()=>{if(!license.success||licenses.length>=100)return;setLicenses(current=>[...current,license.data]);setSku('');setCategory('');setQuantity('');setUnit('');setSource('');};
  const generate=async()=>{
    if(!parsed.success||!local||busy)return;setBusy(true);
    try{const response=await api.generateProposal<ProposalResult>(parsed.data);setServerResult({key,result:response});pushToast('success','Unreviewed commercial scenario generated');}
    catch(error){pushToast('error',error instanceof Error?error.message:'Could not generate scenario');}finally{setBusy(false);}
  };
  const copy=async()=>{if(!result)return;try{await navigator.clipboard.writeText(result.markdownContent);pushToast('success','Scenario draft copied');}catch{pushToast('error','Could not copy draft');}};
  const cost=(value:number|null|undefined)=>value===null||value===undefined?'Not estimated':`${currency} ${value.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const field=(label:string,value:string,set:(value:string)=>void,number=false)=><label key={label}>{label}<input aria-label={label} value={value} maxLength={number?30:500} type={number?'number':'text'} min={number?0:undefined} step={number?'any':undefined} onChange={event=>set(event.target.value)}/></label>;
  return <Panel title="Commercial scenario draft" wide accent="#0284c7" className="proposal-modal">
    <div className="row wrap"><strong>{title}</strong><span className="chip">Draft · unreviewed</span><span className="spacer"/>
      <button className="btn btn-small" disabled={busy||!!error} onClick={()=>void generate()}>{busy?'Generating…':'Generate scenario via server'}</button>
      <button className="btn btn-small" disabled={!result} onClick={()=>void copy()}>Copy Markdown</button>
      <button className="btn btn-small" onClick={()=>openOverlay({kind:'hld'})}>Open architecture draft</button></div>
    <p className="muted small">User-supplied assumptions only. No verified price feed, compliance certification, budget approval or model synthesis.</p>
    <div className="row wrap" style={{gap:8}}>{([['scope','Declared scope'],['scenario','Costs & benefits'],['document','Full document']] as const).map(([id,label])=><button key={id} className="btn btn-small" aria-pressed={tab===id} style={tab===id?{background:'#e0f2fe',borderColor:'#0284c7'}:undefined} onClick={()=>setTab(id)}>{label}</button>)}</div>
    {error&&<p role="alert">{error}</p>}
    <section style={{marginTop:14,maxHeight:'65vh',overflowY:'auto'}}>
      {tab==='scope'&&<><div className="card"><h3>Requirements supplied for review</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
        {field('Proposal title',title,setTitle)}{field('Client organization',client,setClient)}{field('Industry',industry,setIndustry)}
        {field('Users in scope',users,setUsers,true)}{field('Monthly transactions',volume,setVolume,true)}
        <label>Compliance review category<select aria-label="Compliance review category" value={tier} onChange={event=>setTier(event.target.value as ProposalInput['complianceTier'])}><option value="standard">Standard review</option><option value="hipaa">HIPAA requirements review</option><option value="financial">Financial requirements review</option></select></label>
      </div><label>Problem statement<textarea aria-label="Problem statement" rows={3} value={problem} maxLength={8000} onChange={event=>setProblem(event.target.value)}/></label>
      <label>Channels, one per line<textarea aria-label="Channels, one per line" rows={2} value={channels} maxLength={50000} onChange={event=>setChannels(event.target.value)}/></label>
      <label>Integrations, one per line<textarea aria-label="Integrations, one per line" rows={2} value={integrations} maxLength={50000} onChange={event=>setIntegrations(event.target.value)}/></label></div>
      <div className="card"><h3>Evidence required</h3><ul>{result?.missingEvidence.map(item=><li key={item}>{item}</li>)}</ul></div></>}
      {tab==='scenario'&&<><div className="card"><h3>Scenario summary · unvalidated</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
        <div>Monthly licences<strong style={{display:'block'}}>{cost(result?.totalMonthlyLicenseCost)}</strong></div><div>Implementation<strong style={{display:'block'}}>{cost(result?.implementationCostEstimate)}</strong></div>
        <div>Annual savings<strong style={{display:'block'}}>{cost(result?.projectedAnnualSavings)}</strong></div><div>Three-year ROI<strong style={{display:'block'}}>{result?.threeYearRoiPercent===null||!result?'Not estimated':`${result.threeYearRoiPercent}%`}</strong></div></div></div>
      <div className="card"><h3>Explicit commercial assumptions</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
        <label>Display currency<select aria-label="Display currency" value={currency} onChange={event=>setCurrency(event.target.value as typeof currency)}>{['GBP','USD','EUR'].map(code=><option key={code}>{code}</option>)}</select></label>
        {field('Implementation cost',implementation,setImplementation,true)}{field('Other monthly operating costs',operating,setOperating,true)}{field('Delivery duration in weeks',timeline,setTimeline,true)}
        {field('Minutes saved per transaction',minutes,setMinutes,true)}{field('Hourly cost',hourly,setHourly,true)}</div><p className="muted small">Blank values remain unknown. Enter zero only as an explicit assumption. Tax, discounts and omitted costs still need review.</p></div>
      <div className="card"><h3>User-supplied licence lines</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
        {field('Licence or SKU label',sku,setSku)}{field('Licence category',category,setCategory)}{field('Licence quantity',quantity,setQuantity,true)}{field('Monthly unit price',unit,setUnit,true)}{field('Quote source or assumption',source,setSource)}</div>
        <button className="btn btn-small" disabled={!license.success||licenses.length>=100} onClick={addLicense}>Add licence line</button>
        {licenses.map((item,index)=><div className="row wrap" key={index}><strong>{item.sku}</strong><span>{item.quantity} × {cost(item.unitPriceMonthly)}</span><span className="spacer"/>
          <button className="btn btn-small" aria-label={`Remove ${item.sku}`} onClick={()=>setLicenses(current=>current.filter((_,position)=>position!==index))}>Remove</button></div>)}</div></>}
      {tab==='document'&&result&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.markdownContent}</pre>}
    </section>
  </Panel>;
}
