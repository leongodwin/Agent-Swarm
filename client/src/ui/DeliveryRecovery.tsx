import {useState} from 'react';
import {api} from '../api';
import {useResource} from '../useResource';
export function DeliveryRecovery({onRecovered}:{onRecovered:()=>void}){
  const resource=useResource('delivery-startup-recovery',api.deliveryRecovery),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const inspect=()=>{setError('');resource.refresh();};
  async function recover(){const snapshot=resource.value?.snapshotSha256;if(!snapshot||busy||resource.loading)return;setBusy(true);setError('');try{await api.recoverDelivery(snapshot);onRecovered();}catch{setError('Recovery was not accepted. Refresh the inspection before trying again.');resource.refresh();}finally{setBusy(false);}}
  return <section aria-label="Delivery startup recovery" role="status">
    <h3>Delivery needs recovery</h3>
    <p>The workspace remains open. Deployment, release changes and new agent work are held until delivery ownership is verified.</p>
    <button className="btn btn-ghost" disabled={busy||resource.loading} onClick={inspect}>Inspect recovery</button>
    {resource.loading?<p>Inspecting local ownership and history…</p>:resource.error?<p role="alert">Recovery inspection unavailable: {resource.error}</p>:resource.value&&<>
      <p>{resource.value.reason}</p>
      <p>Owner: {resource.value.owner}. Local history: {resource.value.history}.</p>
      {resource.value.canRecover&&<button className="btn" disabled={busy} onClick={()=>void recover()}>Recover empty delivery history</button>}
    </>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
