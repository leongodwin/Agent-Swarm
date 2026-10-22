import {expect,it,vi} from 'vitest';
import {sharepointDeliverySchema,verifySharepointDelivery} from './sharepointDelivery.ts';
import {sharepointHash,type SharepointRequest} from './sharepointProvisioning.ts';
import {assertFirstSliceComponents} from './firstSlice.ts';
import type {ReleasePlan} from './releasePlan.ts';
import {deliveryManifest} from './delivery.ts';
const id='11111111-1111-4111-8111-111111111111',listId='22222222-2222-4222-8222-222222222222';
function fixture(){
 const contract=sharepointDeliverySchema.parse({plan:{schemaVersion:1,tenantId:id,username:'maker@example.test',siteUrl:'https://example.sharepoint.com/sites/probe',siteCollectionId:id,webId:id,resources:[{key:'Requests',displayName:'Probe Requests',template:'genericList',columns:[{name:'Status',kind:'choice',required:true,choices:['New','Processed']}]}]},bindings:[{key:'Requests',listId}]});
 const siteId=`example.sharepoint.com,${id},${id}`,site={id:siteId,webUrl:contract.plan.siteUrl,sharepointIds:{tenantId:id,siteId:id,webId:id}};
 const list={id:listId,displayName:'Probe Requests',description:`CubeFarm:${sharepointHash(contract.plan)}:${id}`,webUrl:contract.plan.siteUrl+'/Lists/Probe',list:{template:'genericList'}};
 const columns=[{name:'Status',required:true,choice:{allowTextEntry:false,displayAs:'dropDownMenu',choices:['New','Processed']}}];
 const request=vi.fn(async(method:string,resource:string)=>{if(method!=='GET')throw Error('Mutation');return resource.includes('/columns')?{value:columns}:resource.includes('/lists/')?list:site;});
 return {contract,site,list,columns,request,guard:vi.fn(async()=>{})};
}
it('verifies bound owned SharePoint schema using GETs without touching business data',async()=>{
 const f=fixture(),result=await verifySharepointDelivery(f.contract,f.request as SharepointRequest,f.guard);
 expect(result).toMatchObject({scope:'sharepoint-release-metadata',planSha256:sharepointHash(f.contract.plan),resources:[{key:'Requests',listId,columnCount:1}]});
 expect(f.request.mock.calls.every(([method,resource])=>method==='GET'&&!resource.includes('/items'))).toBe(true);expect(f.guard.mock.calls.length).toBeGreaterThan(4);
});
it.each(['tenant','site','list-id','name','marker','template','url','schema','duplicate-column'] as const)('rejects %s drift before release acceptance',async fault=>{
 const f=fixture();if(fault==='tenant')f.site.sharepointIds.tenantId=listId;if(fault==='site')f.site.webUrl+='Other';if(fault==='list-id')f.list.id=id;if(fault==='name')f.list.displayName='Other';if(fault==='marker')f.list.description='Other';if(fault==='template')f.list.list.template='documentLibrary';if(fault==='url')f.list.webUrl='https://outside.example/Lists/probe';if(fault==='schema')f.columns[0].required=false;if(fault==='duplicate-column')f.columns.push(f.columns[0]);
 await expect(verifySharepointDelivery(f.contract,f.request as SharepointRequest,f.guard)).rejects.toThrow();
});
it('stops on revoked release authority and never retries provider errors',async()=>{
 const f=fixture();f.request.mockRejectedValueOnce(Error('403'));await expect(verifySharepointDelivery(f.contract,f.request as SharepointRequest,f.guard)).rejects.toThrow('403');expect(f.request).toHaveBeenCalledTimes(1);
 f.request.mockClear();f.guard.mockRejectedValueOnce(Error('Revoked'));await expect(verifySharepointDelivery(f.contract,f.request as SharepointRequest,f.guard)).rejects.toThrow('Revoked');expect(f.request).not.toHaveBeenCalled();
});
it('requires unique complete bindings and separates external lists from solution components',()=>{
 const f=fixture();for(const bindings of [[],[{key:'Other',listId}], [...f.contract.bindings,...f.contract.bindings]])expect(sharepointDeliverySchema.safeParse({...f.contract,bindings}).success).toBe(false);
 const plan={verification:{},firstSlice:{components:[{componentId:'requests',targetKey:'Requests',platform:'sharepoint'}]}} as ReleasePlan;
 expect(()=>assertFirstSliceComponents(plan,{targetComponents:[],sharepoint:f.contract})).not.toThrow();
 expect(()=>assertFirstSliceComponents(plan,{targetComponents:[{key:'Requests',kind:'dataverse-table'}]})).toThrow('external SharePoint mapping');
});
it('requires a matching platform identity and external resource keys distinct from solution keys',()=>{
 const f=fixture(),manifest={schemaVersion:1,solutionUniqueName:'Probe',solutionVersion:'1.0.0.1',solutionZip:'probe.zip',hasUi:true,recovery:{runbook:'recovery.md',rehearsalReport:'rehearsal.json'},documentation:['user.md','admin.md','operations.md'],build:[{executable:'build',args:[]}],test:[{executable:'test',args:[]}],verify:[{executable:'verify',args:[]}],targetBinding:{organizationId:id,userId:id},platformIdentity:{tenantId:id,username:f.contract.plan.username,environmentId:id},sharepoint:f.contract};
 expect(deliveryManifest.safeParse(manifest).success).toBe(true);
 for(const candidate of [{...manifest,platformIdentity:undefined},{...manifest,platformIdentity:{...manifest.platformIdentity,tenantId:listId}},{...manifest,platformIdentity:{...manifest.platformIdentity,username:'other@example.test'}},{...manifest,targetComponents:[{key:'Requests',kind:'canvas',logicalName:'probe_app'}]}])expect(deliveryManifest.safeParse(candidate).success).toBe(false);
});
