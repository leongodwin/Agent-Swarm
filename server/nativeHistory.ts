import {z} from 'zod';
import crypto from 'node:crypto';
/** Delta is latest-state evidence, never a complete historical absence proof. */
export async function collectNativeDelta(resource:string,request:(resource:string)=>Promise<unknown>,guard:()=>Promise<void>){
 const prefix='https://graph.microsoft.com/v1.0/',base=new URL(prefix+resource);if(base.origin!=='https://graph.microsoft.com'||!/^\/v1\.0\/sites\/[^/]+\/lists\/[^/]+\/items\/delta$/.test(base.pathname)||base.search||base.hash)throw new Error('Native delta scope invalid');
 const pageSchema=z.object({value:z.array(z.object({id:z.string().min(1).max(200),deleted:z.record(z.string(),z.unknown()).optional()})).max(1000),'@odata.nextLink':z.string().optional(),'@odata.deltaLink':z.string().optional()});
 const seen=new Set<string>(),pages:{sha256:string;items:{id:string;deleted:boolean}[]}[]=[];let url=base.href+'?$select=id,deleted',count=0;
 for(let n=0;n<100;n++){
  await guard();if(seen.has(url))throw new Error('Native delta continuation loop');seen.add(url);const parsed=pageSchema.parse(await request(url.slice(prefix.length)));await guard();
  count+=parsed.value.length;if(count>10000)throw new Error('Native delta item limit exceeded');
  const items=parsed.value.map(item=>({id:item.id,deleted:item.deleted!==undefined}));pages.push({sha256:crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex'),items});
  const next=parsed['@odata.nextLink'],delta=parsed['@odata.deltaLink'];if(Boolean(next)===Boolean(delta))throw new Error('Native delta terminal/continuation marker missing or conflicting');
  const link=new URL((next??delta)!);if(link.origin!==base.origin||link.pathname!==base.pathname||link.username||link.password||link.hash||link.port||!link.search||/\r|\n/.test((next??delta)!))throw new Error('Native delta continuation scope differs');
  if(!next)return{schemaVersion:1,kind:'graph-list-latest-state-delta',pages,itemsObserved:count,paginationExhausted:true,deltaCursorSha256:crypto.createHash('sha256').update(link.href).digest('hex'),observedAt:new Date().toISOString(),complete:false,completeWrites:false,completeDispatches:false,correlationVerified:false,limitation:'Initial latest-state enumeration is not every historical write. Tombstones lack causal correlation; dispatch history is unavailable. Empty results never authorize replay.'};
  url=link.href;
 }
 throw new Error('Native delta page limit exceeded');
}
