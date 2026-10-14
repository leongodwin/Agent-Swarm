import {expect,it,vi} from 'vitest';
import {requireCodexModelMetadata} from './codexModelMetadata.ts';
import type {HookRpc} from './codexHookTrust.ts';
const a={id:'model-a',model:'gpt-synthetic-a'},b={id:'model-b',model:'gpt-synthetic-b'};
const rpc=(read:(params:any)=>unknown):HookRpc=>({request:vi.fn(async(method,params)=>{expect(method).toBe('model/list');return read(params);}),close:vi.fn(async()=>{})});
it('requires an exact model in two complete matching native inventories',async()=>{
  let pass=0;const source=rpc(()=>({data:++pass===1?[a,b]:[b,a],nextCursor:null}));expect(await requireCodexModelMetadata(source,a.model)).toEqual({scope:'native-codex-model-metadata',model:a.model,inventoryPasses:2,liveAccessVerified:false});expect(source.request).toHaveBeenCalledTimes(2);
});
it('reads cursor pages without using partial inventories',async()=>{
  const source=rpc(params=>params.cursor?{data:[b],nextCursor:null}:{data:[a],nextCursor:'next'});await requireCodexModelMetadata(source,b.model);expect(source.request).toHaveBeenCalledTimes(4);
});
it.each([{data:[a,a],nextCursor:null},{data:[a,{...b,model:a.model}],nextCursor:null},{data:[a]},{data:[],nextCursor:'more'},{data:[{id:'missing-model'}],nextCursor:null}])('rejects ambiguous or incomplete model metadata: %j',async value=>{
  await expect(requireCodexModelMetadata(rpc(()=>value),a.model)).rejects.toThrow();
});
it('rejects drift and unknown selections instead of inferring model access',async()=>{
  let reads=0;await expect(requireCodexModelMetadata(rpc(()=>({data:++reads===1?[a]:[b],nextCursor:null})),a.model)).rejects.toThrow('changed');
  await expect(requireCodexModelMetadata(rpc(()=>({data:[a],nextCursor:null})),b.model)).rejects.toThrow('not advertised');
});
it.each(['', ' gpt-synthetic-a', 'x'.repeat(501)])('validates exact model input before native reads',async selected=>{
  const source=rpc(()=>({data:[a],nextCursor:null}));await expect(requireCodexModelMetadata(source,selected)).rejects.toThrow();expect(source.request).not.toHaveBeenCalled();
});
it('rejects cursor loops, excessive pages and provider failures',async()=>{
  await expect(requireCodexModelMetadata(rpc(()=>({data:[a],nextCursor:'same'})),a.model)).rejects.toThrow();let page=0;
  await expect(requireCodexModelMetadata(rpc(()=>({data:[{id:`id-${++page}`,model:`gpt-${page}`}],nextCursor:`cursor-${page}`})),a.model)).rejects.toThrow('bound');
  await expect(requireCodexModelMetadata(rpc(()=>{throw new Error('Native provider unavailable');}),a.model)).rejects.toThrow('provider unavailable');
});
