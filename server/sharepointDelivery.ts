import {z} from 'zod';
import {sharepointPlan,sharepointHash,sharepointPages,sharepointColumnBody,sameSubset,type SharepointRequest} from './sharepointProvisioning.ts';
const guid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
/** SharePoint resources are external to the Dataverse solution. Bootstrap creates
 * them; every release verifies the exact owned IDs and schema without data writes. */
export const sharepointDeliverySchema=z.strictObject({plan:sharepointPlan,bindings:z.array(z.strictObject({key:z.string(),listId:guid})).min(1).max(5)}).superRefine((v,c)=>{
 if(v.bindings.length!==v.plan.resources.length||new Set(v.bindings.map(b=>b.key)).size!==v.bindings.length||new Set(v.bindings.map(b=>b.listId.toLowerCase())).size!==v.bindings.length||v.bindings.some(b=>!v.plan.resources.some(r=>r.key===b.key)))c.addIssue({code:'custom',message:'Bind every SharePoint resource exactly once to a distinct list ID'});
});
export type SharepointDelivery=z.infer<typeof sharepointDeliverySchema>;
export async function verifySharepointDelivery(raw:unknown,request:SharepointRequest,guard:()=>Promise<void>){
 const contract=sharepointDeliverySchema.parse(raw),{plan}=contract;await guard();
 const url=new URL(plan.siteUrl),siteId=`${url.hostname},${plan.siteCollectionId},${plan.webId}`;
 const site=z.object({id:z.string(),webUrl:z.string(),sharepointIds:z.object({tenantId:guid,siteId:guid,webId:guid})}).parse(await request('GET',`sites/${siteId}?$select=id,webUrl,sharepointIds`));await guard();
 if(site.id.toLowerCase()!==siteId.toLowerCase()||site.webUrl!==plan.siteUrl||site.sharepointIds.tenantId.toLowerCase()!==plan.tenantId.toLowerCase()||site.sharepointIds.siteId.toLowerCase()!==plan.siteCollectionId.toLowerCase()||site.sharepointIds.webId.toLowerCase()!==plan.webId.toLowerCase())throw Error('SharePoint release site binding differs');
 const planSha256=sharepointHash(plan),resources=[];
 for(const resource of plan.resources){
  const binding=contract.bindings.find(b=>b.key===resource.key)!;
  await guard();const row=z.object({id:guid,displayName:z.string(),description:z.string(),webUrl:z.url(),list:z.object({template:z.string()})}).parse(await request('GET',`sites/${siteId}/lists/${binding.listId}?$select=id,displayName,description,webUrl,list`));await guard();
  const listUrl=new URL(row.webUrl);
  if(row.id.toLowerCase()!==binding.listId.toLowerCase()||row.displayName!==resource.displayName||row.list.template!==resource.template||!new RegExp(`^CubeFarm:${planSha256}:[a-f0-9-]{36}$`,'i').test(row.description)||listUrl.origin!==url.origin||!listUrl.pathname.startsWith(url.pathname+'/'))throw Error('SharePoint release resource identity or ownership differs');
  const columns=await sharepointPages(request,`sites/${siteId}/lists/${binding.listId}/columns`);await guard();
  for(const column of resource.columns){const matches=columns.filter(c=>String(c.name).toLowerCase()===column.name.toLowerCase());const target=column.kind==='lookup'?contract.bindings.find(b=>b.key===column.targetKey)?.listId:undefined;
   if(matches.length!==1||!sameSubset(matches[0],sharepointColumnBody(column,target)))throw Error(`SharePoint release schema differs: ${resource.key}/${column.name}`);
  }
  resources.push({key:resource.key,listId:row.id,webUrl:row.webUrl,columnCount:resource.columns.length});
 }
 await guard();return {schemaVersion:1,scope:'sharepoint-release-metadata',planSha256,tenantId:plan.tenantId,siteId,observedAt:new Date().toISOString(),resources,limits:['Metadata and ownership only; no effective permission, runtime, data-preservation or QA approval claim','No mutation or adoption by display name; bootstrap/reconciliation remain separately guarded']};
}
