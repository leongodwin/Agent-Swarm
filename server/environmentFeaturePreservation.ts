import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {environmentFeatureScopeSchema,type EnvironmentFeatureScope} from '../shared/environmentFeatureScope.ts';
const digest=(value:string|Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex'),hash=z.string().regex(/^[a-f0-9]{64}$/),name=z.string().regex(/^(?:intent|held|[0-9]{3}-[a-z0-9-]+)\.json$/);
const indexSchema=z.object({scope:hash,files:z.array(z.object({name,sha256:hash})).min(1).max(32)});
async function pinned(file:string,sha256:string,maxBytes:number){const stat=await fs.lstat(file),bytes=await readBoundedBytes(file,maxBytes);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.resolve(file)||!bytes||digest(bytes)!==sha256)throw Error('Original held evidence changed or is unavailable');return bytes;}
/** Verify local preservation only. No provider settlement, ownership recovery,
 * flow adoption, operation cancellation or hold/lease mutation occurs. */
export async function verifyEnvironmentFeaturePreservation(home:string,leaseRoot:string,raw:EnvironmentFeatureScope,guard:()=>void=()=>{}){
 const scope=environmentFeatureScopeSchema.parse(raw),proof=[];
 for(const item of scope.preserved){
  guard();const file=path.join(home,item.indexName),bytes=await pinned(file,item.indexSha256,65536),index=indexSchema.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(bytes),{maxBytes:65536}));
  if(index.scope!==item.scopeSha256||new Set(index.files.map(entry=>entry.name)).size!==index.files.length)throw Error('Original held index scope differs');
  const root=path.join(home,'planning',item.kind+'-executions',item.scopeSha256);if(await fs.realpath(root)!==path.resolve(root))throw Error('Canonical held journal root required');
  const names=await fs.readdir(root);if(names.length!==index.files.length||names.some(file=>!index.files.some(entry=>entry.name===file)))throw Error('Original held journal membership changed');
  for(const entry of index.files){guard();await pinned(path.join(root,entry.name),entry.sha256,65536);}
  const resource=item.kind+':'+item.scopeSha256,lease=path.join(leaseRoot,digest(resource)+'.json'),leaseBytes=await pinned(lease,item.leaseSha256,16384),leaseValue=z.object({resource:z.literal(resource)}).parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(leaseBytes),{maxBytes:16384}));
  guard();proof.push({kind:item.kind,scopeSha256:item.scopeSha256,indexSha256:item.indexSha256,journalFiles:index.files.map(entry=>({...entry})),leaseSha256:item.leaseSha256,resource:leaseValue.resource,localHoldPreserved:true,providerSettlementVerified:false,replayAuthorized:false});
 }
 guard();return{scope:'local-held-resource-preservation-only' as const,preservedFlowIds:scope.preservedFlowIds,proof,tenantChanges:false as const,providerSettlementVerified:false as const};
}
