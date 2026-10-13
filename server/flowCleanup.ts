/** SDK close may finish after sending a signal. Only its transport onclose
 * callback confirms the owned stdio root exited. No PID polling or port kills. */
export function flowCleanup(client:{close():Promise<void>},transport:{close():Promise<void>;onclose?:()=>void},timeoutMs=5000){
  let attempted=false,acknowledged=false,closed=false,closing:Promise<void>|undefined;
  let resolveExit!:()=>void;const exited=new Promise<void>(resolve=>{resolveExit=resolve;});
  const previous=transport.onclose;
  transport.onclose=()=>{acknowledged=true;resolveExit();previous?.();};
  const bounded=async(fn:()=>Promise<void>,step:string)=>{let timer:NodeJS.Timeout|undefined;try{await Promise.race([Promise.resolve().then(fn),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`FlowAgent ${step} cleanup did not finish within its bound`)),timeoutMs);})]);}finally{if(timer)clearTimeout(timer);}};
  const close=()=>{
    if(closing)return closing;closed=true;
    closing=(async()=>{
      const errors:unknown[]=[];
      try{await bounded(()=>client.close(),'client');}catch(error){errors.push(error);}
      try{await bounded(()=>transport.close(),'transport');}catch(error){errors.push(error);}
      if(attempted&&!acknowledged){let timer:NodeJS.Timeout|undefined;
        try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('FlowAgent process exit is unacknowledged; preserve the runtime and retry cleanup after it closes')),timeoutMs);})]);}catch(error){errors.push(error);}finally{if(timer)clearTimeout(timer);}
      }
      if(errors.length)throw new AggregateError(errors,'FlowAgent cleanup failed or process exit is unacknowledged');
    })().catch(error=>{closing=undefined;throw error;});
    return closing;
  };
  return {started(){attempted=true;},assertOpen(){if(closed)throw new Error('FlowAgent adapter is closed');},close};
}
