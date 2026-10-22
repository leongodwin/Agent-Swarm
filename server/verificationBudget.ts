/** Bound the entire verification phase independently of each usability task.
 * Await cleanup even on timeout; an unresponsive operation is never declared done. */
export async function withVerificationBudget<T>(controller:AbortController,ms:number|undefined,work:()=>Promise<T>):Promise<T>{
 controller.signal.throwIfAborted();
 if(ms!==undefined&&(!Number.isSafeInteger(ms)||ms<1000||ms>3600000))throw Error('Invalid verification suite deadline');
 const reason=Error('Approved verification suite deadline expired; retain partial evidence, no automatic retry');let expired=false;
 const timer=ms===undefined?undefined:setTimeout(()=>{if(!controller.signal.aborted){expired=true;controller.abort(reason);}},ms);
 try{const result=await work();controller.signal.throwIfAborted();return result;}catch(error){if(expired)throw reason;throw error;}finally{if(timer!==undefined)clearTimeout(timer);}
}
