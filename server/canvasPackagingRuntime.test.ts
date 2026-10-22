import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import type {PackagingInputs} from './canvasPackaging.ts';
import type {PackagingRecoveryTransport} from './canvasPackagingRecovery.ts';

// Exercise the runtime's actual transport and admission closures; the state
// machines consuming these closures have their own journal/recovery tests.
const capture=vi.hoisted(()=>({inputs:undefined as unknown as ()=>Promise<PackagingInputs>,connect:undefined as unknown as (input:PackagingInputs)=>Promise<PackagingRecoveryTransport>}));
vi.mock('./canvasPackaging.ts',async original=>({...await original<typeof import('./canvasPackaging.ts')>(),CanvasPackaging:class{constructor(_root:string,_leases:string,inputs:typeof capture.inputs,connect:typeof capture.connect){Object.assign(capture,{inputs,connect});}}}));
vi.mock('./canvasPackagingRecovery.ts',()=>({CanvasPackagingRecovery:class{}}));
vi.mock('./delivery.ts',()=>({deliveryCommands:{run:vi.fn()}}));
vi.mock('./pinnedPreparation.ts',()=>({readPinnedBlob:vi.fn(async(run:(args:string[])=>Promise<string>,commit:string,file:string)=>run(['show',commit+':'+file]))}));
vi.mock('./platformDiscovery.ts',()=>({platformDiscoveryBinding:vi.fn()}));
vi.mock('./dataverseIdentity.ts',()=>({verifyDataverseIdentity:vi.fn()}));
vi.mock('./platformAuth.ts',()=>({parsePacIdentity:vi.fn()}));
vi.mock('./packageInventory.ts',()=>({inspectSolutionPackage:vi.fn()}));
import {canvasPackagingRuntime} from './canvasPackagingRuntime.ts';
import {deliveryCommands} from './delivery.ts';
import {platformDiscoveryBinding} from './platformDiscovery.ts';
import {verifyDataverseIdentity} from './dataverseIdentity.ts';
import {parsePacIdentity} from './platformAuth.ts';
import {inspectSolutionPackage} from './packageInventory.ts';

const app='11111111-1111-4111-8111-111111111111',publisher='22222222-2222-4222-8222-222222222222',solutionId='33333333-3333-4333-8333-333333333333',subject='44444444-4444-4444-8444-444444444444',tenant='55555555-5555-4555-8555-555555555555',canvasId='66666666-6666-4666-8666-666666666666',environmentId='Default-'+tenant;
const binding={environmentUrl:'https://synthetic.crm.dynamics.com',environmentId,organizationId:publisher,userId:subject,tenantId:tenant,username:'maker@example.test'};
const plan={schemaVersion:1,appId:app,environmentId,solutionName:'SyntheticPackage',displayName:'Synthetic Package',publisherId:publisher,publisherPrefix:'syn'};
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'packaging-runtime-'));roots.push(root);
 const record={content:{sourceCommit:'a'.repeat(40)}} as PackagingInputs['record'];
 const guard=vi.fn();vi.mocked(platformDiscoveryBinding).mockReturnValue(binding);
 const pac={...binding};vi.mocked(parsePacIdentity).mockImplementation(()=>pac);
 const claims:Record<string,unknown>={tid:tenant,oid:subject,aud:'https://service.powerapps.com/',exp:Date.now()/1000+3600,preferred_username:binding.username};
 const credential={tenant,accessToken:''};
 let solutions:unknown[]=[{solutionid:solutionId,uniquename:plan.solutionName,description:'marker',_publisherid_value:publisher,ismanaged:false}];
 let apps:unknown[]=[{canvasappid:canvasId,uniquecanvasappid:app,name:'syn_app'}];
 let members:unknown[]=[{objectid:canvasId,componenttype:300}];
 let user={azureactivedirectoryobjectid:subject,domainname:binding.username};
 let powerApp={name:app,properties:{almMode:'Environment',environment:{name:environmentId}}};
 let tokenError=false,nextLink=false;
 const run=vi.mocked(deliveryCommands.run).mockImplementation(async command=>{
  if(command.executable==='git')return JSON.stringify(plan);
  if(command.executable==='pac'&&command.args[0]==='org')return 'synthetic PAC identity';
  if(command.executable==='az'){if(tokenError)throw Error('credentials unavailable');credential.accessToken='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';return JSON.stringify(credential);}
  if(command.executable==='python')return '';
  if(command.executable==='pac'){await fs.writeFile(command.args[command.args.indexOf('--path')+1],'synthetic ZIP fixture');return '';}
  const route=command.args.at(-1)!;
  if(route.includes('systemusers('))return JSON.stringify(user);
  if(route.includes('publishers('))return JSON.stringify({publisherid:publisher,customizationprefix:'syn'});
  const value=route.includes('solutioncomponents?')?members:route.includes('canvasapps?')?apps:solutions;
  return JSON.stringify({value,...nextLink?{'@odata.nextLink':'https://foreign.example.test'}:{}});
 });
 const remote=vi.fn<(url:string,init:RequestInit)=>Promise<Response>>(async()=>new Response(JSON.stringify(powerApp),{status:200}));vi.stubGlobal('fetch',remote);
 vi.mocked(verifyDataverseIdentity).mockImplementation(async(run,request)=>{await run('pac',['org','who']);await request('GET','WhoAmI');return {} as any;});
 const inventory={archiveComplete:true,solution:{name:plan.solutionName,managed:false},components:[{type:300,name:'syn_app'}],resources:[{kind:'canvas',id:'syn_app'}]};vi.mocked(inspectSolutionPackage).mockResolvedValue(inventory as any);
 canvasPackagingRuntime({root,leaseRoot:path.join(root,'leases'),cwd:root,record:()=>record,config:()=>({}) as any,guard});
 return{root,record,guard,run,remote,pac,claims,credential,inventory,get powerApp(){return powerApp;},set powerApp(v){powerApp=v;},set solutions(v:unknown[]){solutions=v;},set apps(v:unknown[]){apps=v;},set members(v:unknown[]){members=v;},set user(v:typeof user){user=v;},set tokenError(v:boolean){tokenError=v;},set nextLink(v:boolean){nextLink=v;},input:()=>capture.inputs(),connect:async()=>capture.connect(await capture.inputs())};
}
it('binds immutable source/configuration digests and drives the same-app packaging transport',async()=>{
 const f=await fixture(),input=await f.input();expect(input.implementationSources).toHaveLength(4);expect(input.implementationSha256).toMatch(/^[a-f0-9]{64}$/);expect(input.configurationSha256).toHaveLength(64);
 const transport=await capture.connect(input);expect(await transport.inspect()).toMatchObject({appId:app,environmentId,publisherId:publisher});
 expect(await transport.observeRecovery(solutionId)).toMatchObject({almMode:'Environment',members:[{objectid:canvasId,componenttype:300}]});
 await transport.createSolution(solutionId,'marker');const sdk=JSON.parse(await fs.readFile(path.join(f.root,'planning/canvas-packaging/sdk-inputs',solutionId+'.json'),'utf8'));expect(sdk).toMatchObject({tenantId:tenant,subject,solutionId,marker:'marker',appId:app});
 await transport.makeSolutionAware(solutionId);expect(f.remote.mock.calls.at(-1)?.[1]).toMatchObject({method:'POST',redirect:'error',body:JSON.stringify({solutionId})});
 expect(await transport.verify(solutionId,'marker')).toEqual({canvasId,playId:app,logicalName:'syn_app',solutionId});
 const exported=await transport.exportSolution(solutionId);expect(exported.bytes).toBeGreaterThan(0);expect(exported.sha256).toHaveLength(64);await expect(transport.exportSolution(solutionId)).rejects.toThrow('already exists');
 expect(f.run.mock.calls.every(([command])=>!['login','publish','import','delete'].some(word=>command.args.includes(word)))).toBe(true);
});
it('requires pinned source and a matching configured environment before connecting',async()=>{const f=await fixture();f.record.content.sourceCommit=null;await expect(f.input()).rejects.toThrow('Pin packaging source');f.record.content.sourceCommit='a'.repeat(40);vi.mocked(platformDiscoveryBinding).mockReturnValue({...binding,environmentId:'foreign'});await expect(f.input()).rejects.toThrow('environment differs');expect(f.remote).not.toHaveBeenCalled();});
it('preserves cancellation and refuses oversized implementation source',async()=>{const f=await fixture();f.guard.mockImplementation(()=>{throw Error('cancelled');});await expect(f.input()).rejects.toThrow('cancelled');f.guard.mockReset();const read=fs.readFile.bind(fs);vi.spyOn(fs,'readFile').mockImplementation(async(...args:any[])=>String(args[0]).includes('canvasPackagingRuntime.ts')?'x'.repeat(24*1024+1):read(...args as Parameters<typeof fs.readFile>) as any);await expect(f.input()).rejects.toThrow('source exceeds');});
it.each(['environmentUrl','environmentId','organizationId','userId','username'] as const)('rejects a mismatched PAC %s before token retrieval',async key=>{const f=await fixture();f.pac[key]=key==='environmentUrl'?'https://foreign.crm.dynamics.com':'foreign';await expect(f.connect()).rejects.toThrow('PAC executing identity differs');expect(f.run.mock.calls.some(([c])=>c.executable==='az')).toBe(false);});
it('refuses write methods during independent identity discovery',async()=>{const f=await fixture();vi.mocked(verifyDataverseIdentity).mockImplementation(async(_run,request)=>{await request('POST','solutions');return {} as any;});await expect(f.connect()).rejects.toThrow('Read only');expect(f.remote).not.toHaveBeenCalled();});
it('never logs in or falls back after delegated credential failure',async()=>{const f=await fixture();f.tokenError=true;await expect(f.connect()).rejects.toThrow('no login or fallback');expect(f.remote).not.toHaveBeenCalled();});
it.each(['credential-tenant','claim-tenant','account','subject','domain','expiry'] as const)('refuses packaging with inconsistent %s',async fault=>{const f=await fixture();if(fault==='credential-tenant')f.credential.tenant=publisher;if(fault==='claim-tenant')f.claims.tid=publisher;if(fault==='account')f.claims.preferred_username='other@example.test';if(fault==='subject')f.user={azureactivedirectoryobjectid:publisher,domainname:binding.username};if(fault==='domain')f.user={azureactivedirectoryobjectid:subject,domainname:'other@example.test'};if(fault==='expiry')f.claims.exp=Date.now()/1000;const action=async()=>{const transport=await f.connect();await transport.inspect();};await expect(action()).rejects.toThrow(fault==='expiry'?'credential expired':['subject','domain'].includes(fault)?'subjects differ':'account differs');expect(f.remote).not.toHaveBeenCalled();});
it.each(['upn','unique_name'] as const)('accepts the independently matched %s claim fallback',async claim=>{const f=await fixture();delete f.claims.preferred_username;f.claims[claim]=binding.username;expect(await(await f.connect()).inspect()).toMatchObject({appId:app});});
it.each(['missing','duplicate','id','marker','publisher','canvas','members','saved-app','pagination'] as const)('refuses inconsistent %s evidence before export',async fault=>{const f=await fixture(),transport=await f.connect();if(fault==='missing')f.solutions=[];if(fault==='duplicate')f.solutions=[{},{}];if(fault==='id')f.solutions=[{solutionid:publisher}];if(fault==='marker')f.solutions=[{solutionid:solutionId,description:'foreign'}];if(fault==='publisher')f.solutions=[{solutionid:solutionId,description:'marker',_publisherid_value:subject}];if(fault==='canvas')f.apps=[];if(fault==='members')f.members=[];if(fault==='saved-app')f.powerApp={...f.powerApp,name:publisher};if(fault==='pagination')f.nextLink=true;await expect(transport.verify(solutionId,'marker')).rejects.toThrow();expect(f.run.mock.calls.some(([c])=>c.args.includes('export'))).toBe(false);});
it.each(['unverified','incomplete','solution','managed','component','canvas-count','resource'] as const)('refuses an export with %s inventory',async fault=>{const f=await fixture(),transport=await f.connect();if(fault!=='unverified')await transport.verify(solutionId,'marker');if(fault==='incomplete')f.inventory.archiveComplete=false;if(fault==='solution')f.inventory.solution.name='Foreign';if(fault==='managed')f.inventory.solution.managed=true;if(fault==='component')f.inventory.components=[];if(fault==='canvas-count')f.inventory.resources=[];if(fault==='resource')f.inventory.resources=[{kind:'canvas',id:'foreign'}];await expect(transport.exportSolution(solutionId)).rejects.toThrow('verified same app');});
