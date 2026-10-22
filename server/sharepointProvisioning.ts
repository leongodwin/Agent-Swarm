import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite} from './atomicFile.ts';
import {readBoundedJson} from './boundedJson.ts';
import {acquireResourceLease} from './resourceLease.ts';
import {projectSharepointHistory} from './sharepointHistory.ts';

const guid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/);
const label=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/);
export const sharepointSiteUrl=z.string().refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^[a-z0-9-]+\.sharepoint\.com$/.test(u.hostname)&&/^\/sites\/[A-Za-z0-9_-]+$/.test(u.pathname)&&u.href===value;}catch{return false;}});
const common={name,required:z.boolean()};
export const sharepointColumn=z.discriminatedUnion('kind',[
 z.strictObject({...common,kind:z.literal('text'),multiline:z.boolean(),maxLength:z.number().int().min(1).max(255).optional()}).superRefine((c,ctx)=>{
  if(c.multiline&&c.maxLength!==undefined||!c.multiline&&c.maxLength===undefined)ctx.addIssue({code:'custom',message:'Text maxLength is required only for single-line columns; multiline length constraints need a separately reviewed application contract'});
 }),
 z.strictObject({...common,kind:z.literal('number'),decimals:z.enum(['none','two','automatic'])}),
 z.strictObject({...common,kind:z.literal('currency'),locale:z.literal('en-GB')}),
 z.strictObject({...common,kind:z.literal('choice'),choices:z.array(label).min(1).max(20).refine(x=>new Set(x.map(v=>v.toLowerCase())).size===x.length)}),
 z.strictObject({...common,kind:z.literal('lookup'),targetKey:name,columnName:z.literal('Title')}),
]);
export const sharepointPlan=z.strictObject({schemaVersion:z.literal(1),tenantId:guid,username:z.email(),siteUrl:sharepointSiteUrl,siteCollectionId:guid,webId:guid,
 resources:z.array(z.strictObject({key:name,displayName:label,template:z.enum(['genericList','documentLibrary']),columns:z.array(sharepointColumn).max(30).refine(x=>new Set(x.map(c=>c.name.toLowerCase())).size===x.length&&!x.some(c=>['title','id','contenttype','created','modified','author','editor'].includes(c.name.toLowerCase())))})).min(1).max(5),
}).superRefine((p,c)=>{for(const key of ['key','displayName'] as const)if(new Set(p.resources.map(r=>r[key].toLowerCase())).size!==p.resources.length)c.addIssue({code:'custom',message:'Duplicate resource identity'});for(let i=0;i<p.resources.length;i++)for(const column of p.resources[i].columns)if(column.kind==='lookup'&&!p.resources.slice(0,i).some(r=>r.key===column.targetKey&&r.template==='genericList'))c.addIssue({code:'custom',message:'Lookup requires an earlier same-plan generic list'});});
export type SharepointPlan=z.infer<typeof sharepointPlan>;
export type SharepointRequest=(method:'GET'|'POST',resource:string,body?:object)=>Promise<unknown>;
export const sharepointHash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const siteSchema=z.object({id:z.string(),webUrl:sharepointSiteUrl,sharepointIds:z.object({tenantId:guid,siteId:guid,webId:guid})});
const listSchema=z.object({id:guid,displayName:z.string(),description:z.string().optional(),webUrl:z.url(),list:z.object({template:z.string()} )});
export const journalSchema=z.strictObject({planSha256:z.string().regex(/^[a-f0-9]{64}$/),authority:z.string().min(1),entries:z.array(z.strictObject({key:name,marker:z.string().regex(/^CubeFarm:[a-f0-9]{64}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),payloadSha256:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['dispatched','verified']),id:guid.optional(),migration:z.string().regex(/^[a-f0-9]{64}$/).optional()})).max(5)});
export async function sharepointPages(request:SharepointRequest,resource:string){
 const rows:Record<string,unknown>[]=[],seen=new Set<string>();let next=resource,bytes=0;
 for(let i=0;i<20;i++){
  if(seen.has(next))throw new Error('SharePoint metadata continuation repeated');seen.add(next);
  const raw=await request('GET',next);bytes+=Buffer.byteLength(JSON.stringify(raw));if(bytes>2*1024*1024)throw new Error('SharePoint metadata exceeds byte bound');
  const page=z.object({value:z.array(z.record(z.string(),z.unknown())),'@odata.nextLink':z.string().optional()}).parse(raw);rows.push(...page.value);
  if(rows.length>1000)throw new Error('SharePoint metadata exceeds row bound');
  if(!page['@odata.nextLink'])return rows;
  const u=new URL(page['@odata.nextLink']),base=new URL('https://graph.microsoft.com/v1.0/'+resource);
  if(u.origin!==base.origin||u.pathname!==base.pathname||u.username||u.password||u.hash||[...u.searchParams.keys()].some(k=>k!=='$skiptoken'&&!base.searchParams.has(k))||[...base.searchParams].some(([k,v])=>u.searchParams.get(k)!==v)||!u.searchParams.get('$skiptoken')||new Set(u.searchParams.keys()).size!==[...u.searchParams].length)throw new Error('SharePoint continuation changed target or query');
  next=u.pathname.slice('/v1.0/'.length)+u.search;
 }
 throw new Error('SharePoint metadata exceeds page bound');
}
export function sharepointColumnBody(c:z.infer<typeof sharepointColumn>,lookupListId?:string){
 c=sharepointColumn.parse(c);
 const base={name:c.name,required:c.required};
 if(c.kind==='lookup'){if(!lookupListId||!guid.safeParse(lookupListId).success)throw Error('Lookup source must be a verified same-plan list');return {...base,lookup:{allowMultipleValues:false,columnName:c.columnName,listId:lookupListId}};}
 if(c.kind==='text')return {...base,text:c.multiline?{allowMultipleLines:true,textType:'plain'}:{allowMultipleLines:false,maxLength:c.maxLength}};
 if(c.kind==='number')return {...base,number:{decimalPlaces:c.decimals,displayAs:'number'}};
 if(c.kind==='currency')return {...base,currency:{locale:c.locale}};
 return {...base,choice:{allowTextEntry:false,displayAs:'dropDownMenu',choices:c.choices}};
}
export function sameSubset(actual:unknown,desired:unknown):boolean{
 if(Array.isArray(desired))return Array.isArray(actual)&&JSON.stringify(actual)===JSON.stringify(desired);
 if(desired&&typeof desired==='object')return !!actual&&typeof actual==='object'&&Object.entries(desired).every(([k,v])=>sameSubset((actual as Record<string,unknown>)[k],v));
 return actual===desired;
}
/** No business items/files or permission mutation. Only exact additive list/library plans. */
export class SharepointProvisioning{
 constructor(private root:string,private leaseRoot:string,private projectHistory?:string){}
 async inventory(siteUrl:string,tenantId:string,request:SharepointRequest,guard:()=>void){
  sharepointSiteUrl.parse(siteUrl);guid.parse(tenantId);guard();const u=new URL(siteUrl);
  const site=siteSchema.parse(await request('GET',`sites/${u.hostname}:${u.pathname}?$select=id,webUrl,sharepointIds`));guard();
  const expected=`${u.hostname},${site.sharepointIds.siteId},${site.sharepointIds.webId}`;
  if(site.webUrl!==siteUrl||site.id.toLowerCase()!==expected.toLowerCase()||site.sharepointIds.tenantId.toLowerCase()!==tenantId.toLowerCase())throw new Error('SharePoint site/tenant identity differs');
  const base=`sites/${site.id}/lists`,raw=await sharepointPages(request,`${base}?$select=id,displayName,description,webUrl,list`);guard();
  if(raw.length>100)throw new Error('SharePoint site has more than100 lists; bounded inventory unavailable');
  const lists=[];const ids=new Set<string>();
  for(const value of raw){const row=listSchema.parse(value);if(ids.has(row.id.toLowerCase()))throw new Error('Duplicate list identity');ids.add(row.id.toLowerCase());
   const url=new URL(row.webUrl);if(url.origin!==u.origin||!url.pathname.startsWith(u.pathname+'/'))throw new Error('List URL escaped the bound site');
   const columns=await sharepointPages(request,`${base}/${row.id}/columns`);guard();lists.push({...row,columns});if(Buffer.byteLength(JSON.stringify(lists))>1024*1024)throw new Error('SharePoint inventory exceeds1MiB');
  }
  const observedAt=new Date().toISOString();return {schemaVersion:1,site,lists,observedAt,expiresAt:new Date(Date.now()+60_000).toISOString(),limits:['Metadata only; no effective-permission, licensing, DLP or runtime approval','No list items or document content read']};
 }
 async execute(input:unknown,authority:string,request:SharepointRequest,guard:()=>void,authorize:()=>Promise<void>,transferredLease?:Awaited<ReturnType<typeof acquireResourceLease>>){
  const plan=sharepointPlan.parse(input),planSha256=sharepointHash(plan);if(!authority||authority.length>4000)throw new Error('Provisioning authority unavailable');
  if(this.projectHistory&&JSON.parse(authority).repoId!==this.projectHistory)throw Error('Project journal authority differs');
  guard();await authorize();guard();
  const siteId=`${new URL(plan.siteUrl).hostname},${plan.siteCollectionId},${plan.webId}`;
  const lease=transferredLease??await acquireResourceLease(this.leaseRoot,`sharepoint:${plan.tenantId.toLowerCase()}:${siteId.toLowerCase()}`,authority,{reclaimDeadOwner:false});await lease.assertOwned();
  let release=!transferredLease;
  try{
   const scoped=this.projectHistory?await projectSharepointHistory(this.leaseRoot,siteId,this.projectHistory,guard):undefined;
   const file=scoped?.file??path.join(this.leaseRoot,'sharepoint-history',`${sharepointHash(siteId.toLowerCase())}.json`);
   const stored=await readBoundedJson(file,64*1024),journal=stored===undefined?{planSha256,authority,entries:[] as z.infer<typeof journalSchema>['entries']}:journalSchema.parse(stored);
   if(new Set(journal.entries.map(e=>e.key)).size!==journal.entries.length||journal.entries.some(e=>!plan.resources.some(r=>r.key===e.key)||!e.migration&&!e.marker.startsWith(`CubeFarm:${planSha256}:`)||e.status==='verified'&&!e.id))throw new Error('Invalid retained SharePoint resource provenance');
   if(journal.planSha256!==planSha256||journal.authority!==authority)throw new Error('Retained SharePoint intent belongs to a different plan or authority; reconcile before proceeding');
   for(const entry of journal.entries.filter(e=>e.migration))await(await import('./sharepointReconciliation.ts')).verifySchemaLineage(this.leaseRoot,plan,journal.authority,entry,guard);
   const check=async()=>{guard();await lease.assertOwned();await scoped?.check();await authorize();guard();};
   const save=async()=>{await check();await atomicWrite(file,JSON.stringify(journal),()=>{guard();return true;});const handle=await fs.open(file,'r+');try{await handle.sync();}finally{await handle.close();}await check();};
   const inventory=await this.inventory(plan.siteUrl,plan.tenantId,request,guard);
   if(inventory.site.id.toLowerCase()!==siteId.toLowerCase())throw new Error('Approved SharePoint site/web IDs changed');
   for(const resource of plan.resources){const existing=inventory.lists.filter(x=>x.displayName.toLowerCase()===resource.displayName.toLowerCase());if(existing.length>1||existing.length&&!journal.entries.some(e=>e.key===resource.key&&e.status==='verified'&&e.id===existing[0].id))throw new Error('Existing SharePoint resource cannot be adopted by name');}
   for(const resource of plan.resources){
    await check();const entries=journal.entries.filter(e=>e.key===resource.key);if(entries.length>1)throw new Error('Ambiguous retained resource history');let entry=entries[0];
    const marker=entry?.marker??`CubeFarm:${planSha256}:${crypto.randomUUID()}`;
    const columnBody=(column:z.infer<typeof sharepointColumn>)=>{if(column.kind!=='lookup')return sharepointColumnBody(column);const parents=journal.entries.filter(e=>e.key===column.targetKey&&e.status==='verified'&&e.id);if(parents.length!==1)throw Error('Lookup parent is not a verified same-plan resource');return sharepointColumnBody(column,parents[0].id);};
    const payload={displayName:resource.displayName,description:marker,list:{template:resource.template},columns:resource.columns.map(columnBody)},payloadSha256=sharepointHash(payload);
    if(entry&&entry.payloadSha256!==payloadSha256)throw new Error('Retained SharePoint payload differs');
    const matches=inventory.lists.filter(x=>x.displayName.toLowerCase()===resource.displayName.toLowerCase());
    if(matches.length>1)throw new Error('Ambiguous existing SharePoint name');
    if(entry?.status==='dispatched'){release=false;throw new Error('SharePoint write outcome unknown; retain intent and reconcile independently without retry');}
    if(entry){if(!matches.length||matches[0].id!==entry.id)throw new Error('Verified SharePoint resource identity changed');}
    else{
     if(matches.length)throw new Error('Existing SharePoint resource cannot be adopted by name');
     release=false;entry={key:resource.key,marker,payloadSha256,status:'dispatched'};journal.entries.push(entry);await save();
     await check();const created=z.object({id:guid}).parse(await request('POST',`sites/${siteId}/lists`,payload));await check();entry.id=created.id;
    }
    const actual=listSchema.parse(await request('GET',`sites/${siteId}/lists/${entry.id}?$select=id,displayName,description,webUrl,list`));
    const columns=await sharepointPages(request,`sites/${siteId}/lists/${entry.id}/columns`);await check();
    const actualUrl=new URL(actual.webUrl),siteUrl=new URL(plan.siteUrl);if(actualUrl.origin!==siteUrl.origin||actualUrl.username||actualUrl.password||actualUrl.hash||actualUrl.search||!actualUrl.pathname.startsWith(siteUrl.pathname+'/'))throw new Error('Created list URL escaped the bound site');
    if(actual.id!==entry.id||actual.displayName!==resource.displayName||actual.description!==marker||actual.list.template!==resource.template||resource.columns.some(c=>columns.filter(x=>x.name===c.name).length!==1||!sameSubset(columns.find(x=>x.name===c.name),columnBody(c))))throw new Error('SharePoint readback differs from the exact owned resource plan');
    entry.status='verified';await save();release=true;
   }
   const evidence=path.join(this.root,'planning','sharepoint-provisioning',`${planSha256}.json`);await atomicWrite(evidence,JSON.stringify(journal),()=>{guard();return true;});
   return {evidence,scope:'additive-sharepoint-schema-only',planSha256,entries:journal.entries,limits:['No effective permission, licensing, DLP or application runtime approval','Only single-value Title lookups to earlier verified lists in this plan; no folders, business items, file content, updates, deletion or permission changes supported']};
  }finally{if(release)await lease.release();}
 }
}
