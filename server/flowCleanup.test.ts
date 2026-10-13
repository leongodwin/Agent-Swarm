import {expect,it,vi} from 'vitest';
import {flowCleanup} from './flowCleanup.ts';
import {spawn} from 'node:child_process';
it('joins concurrent cleanup and waits for native transport-close acknowledgement',async()=>{
  const client={close:vi.fn(async()=>{})},transport={close:vi.fn(async()=>{}),onclose:undefined as (()=>void)|undefined};
  const cleanup=flowCleanup(client,transport);cleanup.started();let done=false;const first=cleanup.close().then(()=>{done=true;});const second=cleanup.close();await Promise.resolve();await Promise.resolve();expect(done).toBe(false);expect(()=>cleanup.assertOpen()).toThrow('closed');transport.onclose!();await Promise.all([first,second]);expect(client.close).toHaveBeenCalledOnce();expect(transport.close).toHaveBeenCalledOnce();
});
it('always attempts transport cleanup and retains client and transport failures',async()=>{
  const client={close:vi.fn(async()=>{throw new Error('Synthetic client close failure');})},transport={close:vi.fn(async()=>{throw new Error('Synthetic transport failure');})};
  const cleanup=flowCleanup(client,transport);const error=await cleanup.close().catch(error=>error);expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toHaveLength(2);expect(transport.close).toHaveBeenCalledOnce();
});
it('does not promote an observation timeout to process exit and permits explicit later cleanup',async()=>{
  const client={close:vi.fn(async()=>{})},transport={close:vi.fn(async()=>{}),onclose:undefined as (()=>void)|undefined};const cleanup=flowCleanup(client,transport,10);cleanup.started();await expect(cleanup.close()).rejects.toThrow('unacknowledged');expect(()=>cleanup.assertOpen()).toThrow('closed');transport.onclose!();await expect(cleanup.close()).resolves.toBeUndefined();
});
it('cleans up an unstarted connection without inventing a process or requiring an exit event',async()=>{
  const transport={close:vi.fn(async()=>{}),onclose:vi.fn()},previous=transport.onclose,cleanup=flowCleanup({close:async()=>{}},transport);await cleanup.close();expect(transport.close).toHaveBeenCalledOnce();transport.onclose();expect(previous).toHaveBeenCalledOnce();
});
it('attempts transport cleanup even when client cleanup never resolves',async()=>{
  const transport={close:vi.fn(async()=>{})},cleanup=flowCleanup({close:()=>new Promise(()=>{})},transport,10);await expect(cleanup.close()).rejects.toThrow('cleanup failed');expect(transport.close).toHaveBeenCalledOnce();
});
it('requires the close event from an owned native subprocess after a stop request',async()=>{
  const child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000);'],{windowsHide:true,stdio:['ignore','pipe','ignore']});let nativeClosed=false;
  const transport={close:async()=>{child.kill();},onclose:undefined as (()=>void)|undefined};const cleanup=flowCleanup({close:async()=>{}},transport);cleanup.started();const closed=new Promise<void>(resolve=>child.once('close',()=>{nativeClosed=true;transport.onclose?.();resolve();}));
  try{await new Promise<void>((resolve,reject)=>{child.stdout!.once('data',()=>resolve());child.once('error',reject);});await cleanup.close();expect(nativeClosed).toBe(true);}
  finally{if(!nativeClosed)child.kill();await closed;}
});
