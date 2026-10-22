import fs from 'node:fs/promises';
import {CanvasPackagingRecovery,type PackagingRecoveryTransport} from './canvasPackagingRecovery.ts';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {CanvasPackaging,packagingPlan,readPackagingResponse,type PackagingInputs} from './canvasPackaging.ts';
import {readPinnedBlob} from './pinnedPreparation.ts';
import {platformDiscoveryBinding} from './platformDiscovery.ts';
import {deliveryCommands} from './delivery.ts';
import {verifyDataverseIdentity} from './dataverseIdentity.ts';
import {parsePacIdentity} from './platformAuth.ts';
import {inspectSolutionPackage} from './packageInventory.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import type {CapabilityConfig} from './capabilityChecks.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
const sha=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
export function canvasPackagingRuntime(context:{root:string;leaseRoot:string;cwd:string;record():DeliveryRecord;config():CapabilityConfig;guard():void}){
 const signal=AbortSignal.timeout(120000),guard=()=>{signal.throwIfAborted();context.guard();};
 const run=(executable:string,args:string[])=>{guard();return deliveryCommands.run({executable,args},context.cwd,{},signal);};
 const inputs=async()=>{
  guard();const record=context.record();if(!record.content.sourceCommit)throw Error('Pin packaging source first');
  const source=await readPinnedBlob(args=>run('git',args),record.content.sourceCommit,'cubefarm.canvas-package.json');
  const plan=packagingPlan.parse(parseUnambiguousJson(source,{maxBytes:4096})),binding=platformDiscoveryBinding(context.config());
  if(binding.environmentId&&binding.environmentId.toLowerCase()!==plan.environmentId.toLowerCase())throw Error('Packaging environment differs');
  const implementationSources=await Promise.all(['canvasPackaging.ts','canvasPackagingRuntime.ts','canvasPackagingRecovery.ts','createPackagingSolution.py'].map(async file=>{const source=await fs.readFile(new URL(file,import.meta.url),'utf8');if(Buffer.byteLength(source)>24*1024)throw Error('Packaging source exceeds review bound');return {file,source,sha256:sha(source)};}));
  const code=implementationSources.map(({file,sha256})=>[file,sha256]);
  return {record,plan,environmentUrl:binding.environmentUrl,implementationSources,implementationSha256:sha(JSON.stringify(code)),configurationSha256:sha(JSON.stringify(context.config()))};
 };
 const connect=async(input:PackagingInputs):Promise<PackagingRecoveryTransport>=>{
  const plan=packagingPlan.parse(input.plan),binding=platformDiscoveryBinding(context.config()),url=binding.environmentUrl;
  const request=async(route:string)=>{guard();const raw=await run('dataverse',['api','request','--target','dataverse','--environment',url,'--method','GET','--path','/api/data/v9.2/'+route]);guard();return parseUnambiguousJson(raw,{maxBytes:2*1024*1024}) as any;};
  await verifyDataverseIdentity((executable,args)=>run(executable,args),async(method,route)=>{if(method!=='GET')throw Error('Read only');return request(route);},url,{organizationId:binding.organizationId,userId:binding.userId},{tenantId:binding.tenantId,username:binding.username,environmentId:plan.environmentId});guard();
  const pac= parsePacIdentity(await run('pac',['org','who','--environment',url]));
  if(new URL(pac.environmentUrl).origin!==new URL(url).origin||pac.environmentId.toLowerCase()!==plan.environmentId.toLowerCase()||pac.organizationId.toLowerCase()!==binding.organizationId.toLowerCase()||pac.userId.toLowerCase()!==binding.userId.toLowerCase()||pac.username.toLowerCase()!==binding.username.toLowerCase())throw Error('Packaging PAC executing identity differs');
  let raw:string;try{raw=await run('az',['account','get-access-token','--resource','https://service.powerapps.com/','--tenant',binding.tenantId,'--output','json']);}catch{guard();throw Error('Power Apps delegated credentials unavailable; no login or fallback attempted');}
  const credential=z.object({tenant:z.uuid(),accessToken:z.string()}).parse(parseUnambiguousJson(raw,{maxBytes:65536}));
  const claims=z.object({tid:z.uuid(),oid:z.uuid(),aud:z.literal('https://service.powerapps.com/'),exp:z.number(),upn:z.string().optional(),preferred_username:z.string().optional(),unique_name:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(credential.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));
  if(credential.tenant.toLowerCase()!==binding.tenantId.toLowerCase()||claims.tid.toLowerCase()!==binding.tenantId.toLowerCase()||String(claims.preferred_username??claims.upn??claims.unique_name).toLowerCase()!==binding.username.toLowerCase())throw Error('Packaging Power Apps account differs');
  const user=await request(`systemusers(${binding.userId})?$select=azureactivedirectoryobjectid,domainname`);if(user.azureactivedirectoryobjectid?.toLowerCase()!==claims.oid.toLowerCase()||user.domainname?.toLowerCase()!==binding.username.toLowerCase())throw Error('Packaging OAuth/Dataverse subjects differ');
  const base=`https://api.powerapps.com/providers/Microsoft.PowerApps/environments/${plan.environmentId}/apps/${plan.appId}`;
  const power=async(method:'GET'|'POST',solutionId?:string)=>{
   guard();if(claims.exp*1000<=Date.now()+30000)throw Error('Packaging credential expired');
   const response=await fetch(base+(method==='POST'?'/makeSolutionAware?api-version=2018-10-01':'?api-version=2016-11-01'),{method,redirect:'error',signal,headers:{Authorization:'Bearer '+credential.accessToken,Accept:'application/json','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({solutionId:z.uuid().parse(solutionId)})}:{})});
   return readPackagingResponse(response,guard);
  };
  const rows=async(route:string)=>z.object({value:z.array(z.record(z.string(),z.unknown())).max(2),'@odata.nextLink':z.never().optional()}).parse(await request(route)).value;
  const canvas=()=>rows('canvasapps?$select=canvasappid,uniquecanvasappid,name&$filter='+encodeURIComponent('uniquecanvasappid eq '+plan.appId)+'&$top=2');
  const solution=()=>rows('solutions?$select=solutionid,uniquename,description,_publisherid_value,ismanaged&$filter='+encodeURIComponent("uniquename eq '"+plan.solutionName+"'")+'&$top=2');
  let verifiedLogicalName:string|undefined;
  return {
   async observeRecovery(solutionId){const app=z.object({name:z.uuid(),properties:z.object({almMode:z.string(),environment:z.object({name:z.string()})})}).parse(await power('GET'));const publisher=z.object({publisherid:z.uuid(),customizationprefix:z.string()}).parse(await request(`publishers(${plan.publisherId})?$select=publisherid,customizationprefix`));const members=await rows('solutioncomponents?$select=objectid,componenttype&$filter='+encodeURIComponent(`_solutionid_value eq ${solutionId}`)+'&$top=2');return {appId:app.name,environmentId:app.properties.environment.name,almMode:app.properties.almMode,publisherId:publisher.publisherid,publisherPrefix:publisher.customizationprefix,solutions:await solution() as any,canvasRows:await canvas() as any,members:members as any};},
   async inspect(){const app=z.object({name:z.uuid(),properties:z.object({environment:z.object({name:z.string()})})}).parse(await power('GET'));const publisher=z.object({publisherid:z.uuid(),customizationprefix:z.string()}).parse(await request(`publishers(${plan.publisherId})?$select=publisherid,customizationprefix`));return {appId:app.name,environmentId:app.properties.environment.name,publisherId:publisher.publisherid,publisherPrefix:publisher.customizationprefix,existingSolutions:await solution(),canvasRows:await canvas()};},
   async createSolution(solutionId,marker){
    const directory=path.join(context.root,'planning','canvas-packaging','sdk-inputs');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,solutionId+'.json');
    await fs.writeFile(file,JSON.stringify({tenantId:binding.tenantId,subject:claims.oid,environmentUrl:url,solutionId,marker,...plan}),{flag:'wx'});guard();
    // SDK, not an arbitrary repository command. The exact helper bytes are reviewed.
    await run('python',[fileURLToPath(new URL('createPackagingSolution.py',import.meta.url)),file]);guard();
   },
   async makeSolutionAware(solutionId){await power('POST',solutionId);},
   async verify(solutionId,marker){
    const solutions=await solution();if(solutions.length!==1||solutions[0].solutionid!==solutionId||solutions[0].description!==marker||String(solutions[0]._publisherid_value).toLowerCase()!==plan.publisherId.toLowerCase())throw Error('Dedicated solution identity differs');
    const apps=await canvas();if(apps.length!==1)throw Error('Same-app Dataverse row unavailable; no conversion retry');const app=z.object({canvasappid:z.uuid(),uniquecanvasappid:z.uuid(),name:z.string()}).parse(apps[0]);
    const members=await rows('solutioncomponents?$select=objectid,componenttype&$filter='+encodeURIComponent(`_solutionid_value eq ${solutionId} and objectid eq ${app.canvasappid} and componenttype eq 300`)+'&$top=2');if(members.length!==1)throw Error('Same app missing from solution');
    const saved=z.object({name:z.uuid()}).parse(await power('GET'));if(saved.name!==plan.appId)throw Error('Saved app changed');verifiedLogicalName=app.name;return {canvasId:app.canvasappid,playId:app.uniquecanvasappid,logicalName:app.name,solutionId};
   },
   async exportSolution(solutionId){const directory=path.join(context.root,'planning','canvas-packaging','exports');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,solutionId+'.zip');if(await fs.lstat(file).then(()=>true,()=>false))throw Error('Export already exists');await run('pac',['solution','export','--name',plan.solutionName,'--path',file,'--managed','false','--environment',url]);guard();const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('Real bounded ZIP required');const bytes=await fs.readFile(file),inventory=await inspectSolutionPackage(file,signal);guard();if(!verifiedLogicalName||!inventory.archiveComplete||inventory.solution?.name!==plan.solutionName||inventory.solution.managed||!inventory.components.some(c=>c.type===300&&c.name===verifiedLogicalName)||inventory.resources.filter(r=>r.kind==='canvas').length!==1||!inventory.resources.some(r=>r.kind==='canvas'&&r.id===verifiedLogicalName))throw Error('Export does not contain the verified same app');return {file,sha256:sha(bytes),bytes:bytes.length};},
  };
 };
 return {packaging:new CanvasPackaging(context.root,context.leaseRoot,inputs,connect),recovery:new CanvasPackagingRecovery(context.root,context.leaseRoot,inputs,connect)};
}
