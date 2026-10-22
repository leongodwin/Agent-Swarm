import fs from 'node:fs';
import path from 'node:path';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {toolObservation} from './toolObservation.ts';
import {sharepointPlan,sharepointHash} from './sharepointProvisioning.ts';

const object=(v:unknown):Record<string,any>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:null;
const decode=(v:unknown)=>typeof v==='string'?parseUnambiguousJson(v,{maxBytes:768*1024,maxDepth:32,maxSyntaxTokens:50000}):v;
/** Deny-only conservative list-field check, not operation-schema/permission or preservation proof. */
export class SharepointFlowContract {
 private schemas=new Map<string,{data:Record<string,any>;expires:number;plan:string}>();
 constructor(private cwd:string,private repoId:string|undefined,private now:()=>number){}
 private plan(){const file=path.join(this.cwd,'cubefarm.sharepoint.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Invalid SharePoint plan');return sharepointPlan.parse(parseUnambiguousJson(fs.readFileSync(file,'utf8')));}
 capture(name:string,input:Record<string,unknown>,raw:unknown,failed:boolean){
  if(name!=='mcp__office__platform_discovery')return;
  let request:Record<string,any>|null;try{request=object(decode(input.request_json));}catch{return;}
  if(request?.kind!=='sharepoint-list-schema'||typeof request.resourceKey!=='string')return;
  const key=request.resourceKey;this.schemas.delete(key);
  if(failed||!this.repoId)return;
  try{
   // platform_discovery returns {observation,evidence} inside its MCP content.
   // Do not mistake the transport envelope for the actual scoped observation.
   const envelope=toolObservation(raw).data,receipt=object(envelope?.observation),data=object(receipt?.data),binding=object(receipt?.binding),plan=this.plan(),items=object(data?.metadata?.schema?.items);
   const observed=Date.parse(String(receipt?.observedAt)),expires=Date.parse(String(receipt?.expiresAt));
   const returnedRequest=object(receipt?.request);
   if(!receipt||receipt.scope!=='read-only-platform-metadata'||returnedRequest?.kind!==request.kind||returnedRequest?.resourceKey!==key||!data||!binding||!items||!object(items.properties)||!Array.isArray(items.required)||!items.required.every((x:unknown)=>typeof x==='string'&&Object.hasOwn(items.properties,x)))return;
   if(data.scope!=='native-sharepoint-list-schema'||data.repoId!==this.repoId||data.resourceKey!==key||data.planSha256!==sharepointHash(plan)||data.siteUrl!==plan.siteUrl||!plan.resources.some(r=>r.key===key)||data.tenantId!==plan.tenantId||data.username!==plan.username||binding.tenantId!==data.tenantId||binding.username!==data.username||binding.environmentId!==data.environmentId||data.metadata.name!==data.listId||typeof data.connectionId!=='string'||!data.connectionId)return;
   if(!Number.isFinite(observed)||!Number.isFinite(expires)||observed>this.now()||expires<=this.now()||expires<=observed||expires-observed>900000)return;
   this.schemas.set(key,{data:structuredClone(data),expires,plan:sharepointHash(plan)});
  }catch{/* Failed refresh cannot retain old schema. */}
 }
 check(name:string,input:Record<string,unknown>):string|null{
  if(!['mcp__flowagent__create_flow','flowagent_create_flow','mcp_flowagent_create_flow','mcp__swarm_flowagent__create_flow','swarm_flowagent_create_flow','mcp_swarm_flowagent_create_flow'].includes(name))return null;
  try{
   // Round-trip objects too: apply the same byte/depth budget as string arguments.
   const definition=object(decode(typeof input.definition==='string'?input.definition:JSON.stringify(input.definition))),refs=object(decode(typeof input.connectionRefs==='string'?input.connectionRefs:JSON.stringify(input.connectionRefs)));
   if(!definition||!object(definition.actions))throw Error('Bounded flow definition/actions required');
   let nodes=0;
   const walk=(actions:unknown,depth=0)=>{
    if(!object(actions)||depth>24)throw Error('Unsupported action container');
    for(const [label,raw] of Object.entries(actions as object)){
     if(++nodes>2000)throw Error('Too many flow actions');const action=object(raw);if(!action)throw Error('Malformed action');
     const host=object(action.inputs?.host),alias=host?.connectionName,ref=refs&&typeof alias==='string'?object(refs[alias]):null;
     const sp=String(host?.apiId??'').endsWith('/shared_sharepointonline')||String(ref?.id??'').endsWith('/shared_sharepointonline')||alias==='shared_sharepointonline';
     if(sp&&host?.operationId==='PatchItem'){
      if(action.type!=='OpenApiConnection'||!String(host.apiId).endsWith('/shared_sharepointonline')||!ref||!String(ref.id).endsWith('/shared_sharepointonline'))throw Error(`${label}: unresolved SharePoint binding`);
      const p=object(action.inputs?.parameters),item=object(p?.item),plan=this.plan();
      const receipt=[...this.schemas.values()].find(s=>s.expires>this.now()&&s.plan===sharepointHash(plan)&&s.data.siteUrl===p?.dataset&&s.data.listId===p?.table&&s.data.environmentId===input.env&&s.data.connectionId===ref.connectionName);
      if(!receipt)throw Error(`${label}: fresh exact-target SharePoint schema required`);
      if(!item||Object.keys(p!).some(k=>k.startsWith('item/')))throw Error(`${label}: bounded nested item object required`);
      const fields=receipt.data.metadata.schema.items;
      for(const field of fields.required){const metadata=fields.properties[field];if(metadata['x-ms-permission']==='read-only')continue;if(!Object.hasOwn(item,field)||item[field]===null||item[field]===undefined)throw Error(`${label}: missing required item/${field}; preserve fresh same-item values under an approved contract`);}
     }
     if(action.actions!==undefined)walk(action.actions,depth+1);
     if(action.else!==undefined){if(!object(action.else))throw Error('Malformed else');if(action.else.actions!==undefined)walk(action.else.actions,depth+1);}
     if(action.cases!==undefined){if(!object(action.cases))throw Error('Malformed cases');for(const c of Object.values(action.cases)){if(!object(c))throw Error('Malformed case');walk((c as any).actions,depth+1);}}
     if(action.default!==undefined){if(!object(action.default))throw Error('Malformed default');if(action.default.actions!==undefined)walk(action.default.actions,depth+1);}
    }
   };walk(definition.actions);return null;
  }catch(error){return `SharePoint conservative required-field precheck: ${error instanceof Error?error.message:'unverifiable flow'}. This check grants no write, preservation or QA approval.`;}
 }
}
