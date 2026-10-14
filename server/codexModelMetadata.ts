import {z} from 'zod';
import type {HookRpc} from './codexHookTrust.ts';
const model=z.object({id:z.string().min(1).max(500),model:z.string().min(1).max(500)});
const page=z.object({data:z.array(model).max(100),nextCursor:z.string().min(1).max(4000).nullable()});
/** Advertised metadata only; no inference request and no claim of live model access. */
export async function requireCodexModelMetadata(rpc:HookRpc,selected:string){
  z.string().min(1).max(500).refine(value=>value===value.trim(),'Model pin must be exact').parse(selected);
  const inventory=async()=>{
    const rows:z.infer<typeof model>[]=[],cursors=new Set<string>();let cursor:string|undefined;
    for(let index=0;index<10;index++){
      const result=page.parse(await rpc.request('model/list',{limit:100,includeHidden:true,...(cursor?{cursor}:{})}));rows.push(...result.data);
      if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.model)).size!==rows.length)throw new Error('Codex model metadata is ambiguous');
      if(result.nextCursor===null)return rows.sort((a,b)=>a.model.localeCompare(b.model));
      if(!result.data.length||cursors.has(result.nextCursor))throw new Error('Codex model metadata pagination is incomplete');
      cursor=result.nextCursor;cursors.add(cursor);
    }
    throw new Error('Codex model metadata exceeded its bound');
  };
  const before=await inventory(),after=await inventory();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Codex model metadata changed during observation');
  if(!before.some(row=>row.model===selected))throw new Error('Explicit Codex model is not advertised by the native catalogue; select a listed model or clear the override');
  return {scope:'native-codex-model-metadata' as const,model:selected,inventoryPasses:2,liveAccessVerified:false as const};
}
