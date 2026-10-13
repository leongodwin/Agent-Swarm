/** A failed consumer must not prevent native-exit/capacity observers from running.
 * Diagnostics deliberately omit callback values and provider exception contents. */
export function terminalCallback<T>(callback:(value:T)=>unknown,value:T,report:()=>void=()=>console.warn('Terminal callback failed; other listeners remain active')):void{
  const failed=()=>{try{report();}catch{/* A logger failure cannot poison terminal supervision. */}};
  try{
    const result=callback(value);
    if(result&&typeof (result as {then?:unknown}).then==='function')void Promise.resolve(result).catch(failed);
  }catch{failed();}
}
export function terminalListeners<T>(callbacks:readonly ((value:T)=>unknown)[],value:T):void{
  for(const callback of [...callbacks])terminalCallback(callback,value);
}
