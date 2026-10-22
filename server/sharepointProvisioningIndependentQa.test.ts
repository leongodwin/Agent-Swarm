import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {SharepointProvisioning,sharepointPages,sharepointPlan,sharepointHash,type SharepointRequest} from './sharepointProvisioning.ts';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const tenant='11111111-1111-4111-8111-111111111111',web='22222222-2222-4222-8222-222222222222',list='33333333-3333-4333-8333-333333333333',siteUrl='https://synthetic.sharepoint.com/sites/Probe',siteId=`synthetic.sharepoint.com,${tenant},${web}`;
function plan(){return sharepointPlan.parse({schemaVersion:1,tenantId:tenant,username:'qa@example.test',siteUrl,siteCollectionId:tenant,webId:web,resources:[{key:'Probe',displayName:'Probe List',template:'genericList',columns:[]}]});}
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sp-independent-'));roots.push(root);let payload:any;const request=vi.fn<SharepointRequest>(async(method,resource,body)=>{if(method==='POST'){payload=body;return{id:list};}if(resource.includes('/columns'))return{value:[]};if(resource.includes(`/lists/${list}?`))return{id:list,...payload,webUrl:siteUrl+'/Lists/Probe'};if(resource.includes('/lists?'))return{value:[]};return{id:siteId,webUrl:siteUrl,sharepointIds:{tenantId:tenant,siteId:tenant,webId:web}};});const leases=path.join(root,'leases');return{root,leases,request,service:new SharepointProvisioning(path.join(root,'office1'),leases)};}
it('persists dispatched intent before POST and refuses blind retry after provider failure',async()=>{
 const f=await fixture(),native=f.request.getMockImplementation()!;let posts=0;
 f.request.mockImplementation(async(...args)=>{if(args[0]==='POST'){posts++;const files=await fs.readdir(path.join(f.leases,'sharepoint-history'));const saved=JSON.parse(await fs.readFile(path.join(f.leases,'sharepoint-history',files[0]),'utf8'));expect(saved.entries[0].status).toBe('dispatched');throw Error('provider connection lost');}return native(...args);});
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow('provider connection lost');
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow();expect(posts).toBe(1);
});
it('prevents a second office dispatch after an unknown provider outcome',async()=>{
 const f=await fixture(),native=f.request.getMockImplementation()!;let posts=0;f.request.mockImplementation(async(...args)=>{if(args[0]==='POST'){posts++;throw Error('unknown provider outcome');}return native(...args);});
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow();
 const other=new SharepointProvisioning(path.join(f.root,'office2'),f.leases);
 await expect(other.execute(plan(),'other-approved',f.request,()=>{},async()=>{})).rejects.toThrow();expect(posts).toBe(1);
});
it('rejects created-list readback escaping the approved site',async()=>{
 const f=await fixture(),native=f.request.getMockImplementation()!;f.request.mockImplementation(async(...args)=>{const value=await native(...args);return args[1].includes(`/lists/${list}?`)?{...(value as object),webUrl:'https://other.sharepoint.com/sites/Other/Lists/Probe'}:value;});
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow();
});
it('does not adopt or alter an existing same-name list',async()=>{
 const f=await fixture(),native=f.request.getMockImplementation()!;f.request.mockImplementation(async(...args)=>args[1].includes('/lists?')?{value:[{id:list,displayName:'Probe List',description:'existing owner',webUrl:siteUrl+'/Lists/Probe',list:{template:'genericList'}}]}:native(...args));
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow('cannot be adopted');expect(f.request.mock.calls.some(c=>c[0]==='POST')).toBe(false);
});
it('checks site tenant identity before enumerating lists',async()=>{const f=await fixture();f.request.mockResolvedValue({id:siteId,webUrl:siteUrl,sharepointIds:{tenantId:web,siteId:tenant,webId:web}});await expect(f.service.inventory(siteUrl,tenant,f.request,()=>{})).rejects.toThrow('identity differs');expect(f.request).toHaveBeenCalledTimes(1);});
it.each(['origin','path','query','duplicate','repeated'])('rejects %s pagination drift without following it',async mode=>{
 const resource=`sites/${siteId}/lists?$select=id`,base='https://graph.microsoft.com/v1.0/'+resource;
 const link=mode==='origin'?base.replace('graph.microsoft.com','evil.test')+'&$skiptoken=x':mode==='path'?base.replace('/lists','/items')+'&$skiptoken=x':mode==='query'?base.replace('$select=id','$select=other')+'&$skiptoken=x':mode==='duplicate'?base+'&$skiptoken=a&$skiptoken=b':base+'&$skiptoken=x';
 const request=vi.fn<SharepointRequest>(async()=>({value:[],'@odata.nextLink':link}));await expect(sharepointPages(request,resource)).rejects.toThrow();expect(request.mock.calls.length).toBe(mode==='repeated'?2:1);
});
it('refuses post-inventory authority revocation before any POST',async()=>{const f=await fixture();let authorized=0;await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{if(++authorized>1)throw Error('review revoked');})).rejects.toThrow('review revoked');expect(f.request.mock.calls.some(c=>c[0]==='POST')).toBe(false);});
it('does not reclaim a dead caller lease without independent reconciliation',async()=>{
 const f=await fixture(),resource=`sharepoint:${tenant}:${siteId}`;await fs.mkdir(f.leases,{recursive:true});await fs.writeFile(path.join(f.leases,crypto.createHash('sha256').update(resource).digest('hex')+'.json'),JSON.stringify({resource,owner:'previous-office',pid:2147483647,token:tenant,acquiredAt:new Date().toISOString()}));
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow('interrupted owner');expect(f.request).not.toHaveBeenCalled();
});
it('verifies all supported column bodies and writes only one exact new list',async()=>{
 const f=await fixture(),value=plan(),native=f.request.getMockImplementation()!;let created:any;
 value.resources[0].columns=[{name:'Summary',kind:'text',multiline:false,maxLength:100,required:true},{name:'Count',kind:'number',decimals:'none',required:false},{name:'Cost',kind:'currency',locale:'en-GB',required:false},{name:'State',kind:'choice',choices:['Open','Closed'],required:true}];
 f.request.mockImplementation(async(...args)=>{if(args[0]==='POST')created=args[2];if(args[1].endsWith('/columns'))return{value:created?.columns??[]};return native(...args);});
 const result=await f.service.execute(value,'approved',f.request,()=>{},async()=>{});expect(result.entries[0]).toMatchObject({status:'verified',id:list});
 expect(f.request.mock.calls.filter(c=>c[0]==='POST')).toHaveLength(1);expect(created.columns[3].choice).toEqual({allowTextEntry:false,displayAs:'dropDownMenu',choices:['Open','Closed']});expect(JSON.parse(await fs.readFile(result.evidence,'utf8')).entries[0].status).toBe('verified');
});
it.each(['column-missing','column-duplicate','column-changed','wrong-marker','wrong-template'])('retains unknown outcome for %s readback',async mode=>{
 const f=await fixture(),value=plan(),native=f.request.getMockImplementation()!;value.resources[0].columns=[{name:'State',kind:'choice',choices:['Open'],required:true}];let created:any;
 f.request.mockImplementation(async(...args)=>{if(args[0]==='POST')created=args[2];if(args[1].endsWith('/columns')){const rows=created?.columns??[];return{value:mode==='column-missing'?[]:mode==='column-duplicate'?[...rows,...rows]:mode==='column-changed'?rows.map((c:any)=>({...c,required:false})):rows};}const out=await native(...args);return args[1].includes(`/lists/${list}?`)?{...(out as object),...(mode==='wrong-marker'?{description:'other-owner'}:{}),...(mode==='wrong-template'?{list:{template:'documentLibrary'}}:{})}:out;});
 await expect(f.service.execute(value,'approved',f.request,()=>{},async()=>{})).rejects.toThrow();await expect(new SharepointProvisioning(path.join(f.root,'office2'),f.leases).execute(value,'other',f.request,()=>{},async()=>{})).rejects.toThrow();expect(f.request.mock.calls.filter(c=>c[0]==='POST')).toHaveLength(1);
});
it('rechecks previously verified owned resources without replaying creation',async()=>{
 const f=await fixture(),native=f.request.getMockImplementation()!;let created:any;
 f.request.mockImplementation(async(...args)=>{if(args[0]==='POST')created=args[2];if(args[1].includes('/lists?')&&created)return{value:[{id:list,...created,webUrl:siteUrl+'/Lists/Probe'}]};return native(...args);});
 await f.service.execute(plan(),'approved',f.request,()=>{},async()=>{});await f.service.execute(plan(),'approved',f.request,()=>{},async()=>{});expect(f.request.mock.calls.filter(c=>c[0]==='POST')).toHaveLength(1);
 await expect(f.service.execute(plan(),'changed-owner',f.request,()=>{},async()=>{})).rejects.toThrow('different plan or authority');
});
it('does not dispatch when durable intent persistence fails',async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.leases,'sharepoint-history'),{recursive:true});const planValue=plan();
 // A directory at the exact journal target causes persistence failure before POST.
 const key=crypto.createHash('sha256').update(JSON.stringify(siteId.toLowerCase())).digest('hex');await fs.mkdir(path.join(f.leases,'sharepoint-history',key+'.json'));
 await expect(f.service.execute(planValue,'approved',f.request,()=>{},async()=>{})).rejects.toThrow();expect(f.request.mock.calls.some(c=>c[0]==='POST')).toBe(false);
});
it.each(['folders','lookup','seed','reserved-column','duplicate-resource'])('refuses unsupported or ambiguous %s plan input',mode=>{
 const value:any=plan();if(mode==='folders')value.resources[0].folders=['new'];if(mode==='lookup')value.resources[0].columns=[{name:'Related',kind:'lookup',required:false}];if(mode==='seed')value.seeds=[{}];if(mode==='reserved-column')value.resources[0].columns=[{name:'Title',kind:'text',required:false,multiline:false,maxLength:100}];if(mode==='duplicate-resource')value.resources.push({...value.resources[0]});
 expect(sharepointPlan.safeParse(value).success).toBe(false);
});
it('does not send POST if the intent fsync barrier cannot open the journal',async()=>{
 const f=await fixture(),open=fs.open.bind(fs);vi.spyOn(fs,'open').mockImplementation(((...args:any[])=>args[1]==='r+'?Promise.reject(Error('intent sync unavailable')):Reflect.apply(open,fs,args)) as typeof fs.open);
 await expect(f.service.execute(plan(),'approved',f.request,()=>{},async()=>{})).rejects.toThrow('intent sync unavailable');expect(f.request.mock.calls.some(c=>c[0]==='POST')).toBe(false);
});
it('does not ignore an unknown dispatched resource in retained shared history',async()=>{
 const f=await fixture(),value=plan(),folder=path.join(f.leases,'sharepoint-history');await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(path.join(folder,sharepointHash(siteId.toLowerCase())+'.json'),JSON.stringify({planSha256:sharepointHash(value),authority:'approved',entries:[{key:'UnknownResource',marker:`CubeFarm:${sharepointHash(value)}:${tenant}`,payloadSha256:'a'.repeat(64),status:'dispatched'}]}));
 await expect(f.service.execute(value,'approved',f.request,()=>{},async()=>{})).rejects.toThrow();expect(f.request.mock.calls.some(c=>c[0]==='POST')).toBe(false);
});
