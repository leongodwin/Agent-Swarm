import type {FlowAdapter} from './flowAdapter.ts';

/** Bind every read/write and its response to a live delivery/target owner.
 * An issued remote request can continue; losing ownership revokes its acceptance. */
export async function connectOwnedFlowAdapter(connect:()=>Promise<FlowAdapter>,owned:()=>Promise<void>,signal:AbortSignal):Promise<FlowAdapter> {
  signal.throwIfAborted();await owned();signal.throwIfAborted();
  const adapter=await connect();
  let closed=false,closing:Promise<void>|undefined;
  const close=()=>{
    if(closing)return closing;
    closed=true;
    closing=Promise.resolve().then(()=>adapter.close());
    return closing;
  };
  const check=async()=>{
    if(closed)throw new Error('Flow adapter is closed');
    signal.throwIfAborted();await owned();signal.throwIfAborted();
    if(closed)throw new Error('Flow adapter is closed');
  };
  try{await check();}catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Flow adapter admission and cleanup failed');}throw error;}
  const admitted=async()=>{
    try{await check();}catch(error){
      try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Flow adapter request and cleanup failed');}throw error;
    }
  };
  return {close,async call(tool,args){
    await admitted();
    let result:unknown;
    try{result=await adapter.call(tool,args);}catch(error){await admitted();throw error;}
    await admitted();return result;
  }};
}
