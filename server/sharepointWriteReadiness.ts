import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {connectSharepointSchemaWriter} from './sharepointSchemaWriter.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {sharepointSiteUrl,sharepointPages,sharepointHash,sharepointPlan} from './sharepointProvisioning.ts';
import {connectSharepointGraph,SharepointGraphHttpError} from './sharepointGraph.ts';
import type {FlowAdapter} from './flowAdapter.ts';

const guid=z.uuid();
const proposalIdentity={repoId:z.string().min(1).max(200),tenantId:guid,username:z.email(),siteUrl:sharepointSiteUrl,siteCollectionId:guid,webId:guid};
const targetIdentity={key:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),template:z.enum(['genericList','documentLibrary'])};
/** Version 1 retains its historical test-name restriction. Version 2 explicitly
 * proposes normal plan labels; exact operator approval, absence checks and
 * create-only ownership rules still govern every target. */
export const writeTargetProposal=z.discriminatedUnion('schemaVersion',[
 z.strictObject({schemaVersion:z.literal(1),...proposalIdentity,targets:z.array(z.strictObject({key:targetIdentity.key,displayName:z.string().regex(/^AS-E2E [A-Za-z0-9][A-Za-z0-9 -]{0,60}$/),template:targetIdentity.template})).min(1).max(5)}),
 z.strictObject({schemaVersion:z.literal(2),...proposalIdentity,targets:z.array(z.strictObject({key:targetIdentity.key,displayName:sharepointPlan.shape.resources.element.shape.displayName,template:targetIdentity.template})).min(1).max(5)}),
]).superRefine((p,c)=>{for(const key of ['key','displayName'] as const)if(new Set(p.targets.map(t=>t[key].toLowerCase())).size!==p.targets.length)c.addIssue({code:'custom',message:'Duplicate proposed target'});});
type Binding={tenantId:string;username:string;environmentId:string};
export async function pinWriteTargetProposal(root:string,repoId:string,binding:{tenantId:string;username:string},guard:()=>void){
 const file=path.join(root,'write-target-proposal.json');
 const regular=async()=>{guard();const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Dedicated target proposal path differs');guard();};await regular();
 const raw=await readBoundedBytes(file,16384);if(!raw)throw Error('Dedicated target proposal unavailable');
 const proposal=writeTargetProposal.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(raw),{maxBytes:16384}));
 if(proposal.repoId!==repoId||proposal.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||proposal.username.toLowerCase()!==binding.username.toLowerCase())throw Error('Dedicated target proposal binding differs');
 const owned=async()=>{guard();await regular();if(!raw.equals(await readBoundedBytes(file,16384)??Buffer.alloc(0)))throw Error('Dedicated target proposal changed');await regular();guard();};await owned();return{proposal,owned};
}
export async function assertDedicatedWriteTargets(root:string,repoId:string,plan:{tenantId:string;username:string;siteUrl:string;siteCollectionId:string;webId:string;resources:{key:string;displayName:string;template:string}[]},guard:()=>void){
 const {proposal,owned}=await pinWriteTargetProposal(root,repoId,plan,guard);
 if(proposal.siteUrl!==plan.siteUrl||proposal.siteCollectionId.toLowerCase()!==plan.siteCollectionId.toLowerCase()||proposal.webId.toLowerCase()!==plan.webId.toLowerCase()||proposal.targets.length!==plan.resources.length||proposal.targets.some(t=>!plan.resources.some(r=>r.key===t.key&&r.displayName===t.displayName&&r.template===t.template)))throw Error('Pinned schema plan differs from dedicated target proposal');await owned();
}
/** Proposed new resources only. Neither absence, token scopes nor a Connected
 * connection is design/task, target ownership, writer execution or release proof. */
export async function sharepointWriteReadiness(root:string,repoId:string,binding:Binding,cwd:string,signal:AbortSignal,guard:()=>void,flow:FlowAdapter,connectionId:string,connect:typeof connectSharepointGraph=(tenantId,username,cwd,signal,guard)=>connectSharepointSchemaWriter(root,{tenantId,username},cwd,signal,guard)){
 const check=()=>{signal.throwIfAborted();guard();};check();
 let phase='proposal';
 try{
  const {proposal,owned}=await pinWriteTargetProposal(root,repoId,binding,check);
  phase='writer-credentials';const graph=await connect(binding.tenantId,binding.username,cwd,signal,guard);await owned();
  const siteId=`${new URL(proposal.siteUrl).hostname},${proposal.siteCollectionId},${proposal.webId}`,route=`sites/${siteId}/lists?$select=id,displayName,webUrl,list`;
  const read=async(method:'GET'|'POST',resource:string)=>{await owned();if(method!=='GET')throw Error();const result=await graph('GET',resource);await owned();return result;};
  const pass=async()=>{
   phase='site';const site=z.object({id:z.string(),webUrl:z.string(),sharepointIds:z.object({tenantId:guid,siteId:guid,webId:guid})}).parse(await read('GET',`sites/${siteId}?$select=id,webUrl,sharepointIds`));
   if(site.id.toLowerCase()!==siteId.toLowerCase()||site.webUrl!==proposal.siteUrl||site.sharepointIds.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||site.sharepointIds.siteId.toLowerCase()!==proposal.siteCollectionId.toLowerCase()||site.sharepointIds.webId.toLowerCase()!==proposal.webId.toLowerCase())throw Error();
   phase='list-inventory';const rows=z.array(z.object({id:guid,displayName:z.string(),webUrl:z.url(),list:z.object({template:z.string()})})).max(100).parse(await sharepointPages(read,route));
   if(new Set(rows.map(r=>r.id.toLowerCase())).size!==rows.length)throw Error();for(const row of rows){const u=new URL(row.webUrl);if(u.origin!==new URL(proposal.siteUrl).origin||u.username||u.password||u.search||u.hash||!u.pathname.startsWith(new URL(proposal.siteUrl).pathname+'/'))throw Error();}
   phase='connection';const connections=z.array(z.object({name:z.string(),connector:z.string(),status:z.string(),accountName:z.string().nullable().optional(),statuses:z.array(z.object({status:z.string()})).optional()})).max(1000).parse(await flow.call('list_connections',{env:binding.environmentId,connector:'shared_sharepointonline'}));await owned();
   const matches=connections.filter(c=>c.name===connectionId);if(matches.length!==1)throw Error();const connection=matches[0];
   if(connection.connector!=='/providers/Microsoft.PowerApps/apis/shared_sharepointonline'||connection.status!=='Connected'||connection.accountName?.toLowerCase()!==binding.username.toLowerCase()||connection.statuses?.some(s=>s.status!=='Connected'))throw Error();
   phase='catalogue';const catalogue=z.object({value:z.array(z.object({Name:z.string()})).max(1000),error:z.never().optional(),'@odata.nextLink':z.never().optional()}).parse(await flow.call('invoke_operation',{env:binding.environmentId,connector:'shared_sharepointonline',connection:connectionId,operation:'GetDataSets',params:{}}));await owned();
   const catalogueTargetVisible=catalogue.value.some(s=>s.Name===proposal.siteUrl);
   return{targets:proposal.targets.map(t=>({...t,state:rows.some(r=>r.displayName.toLowerCase()===t.displayName.toLowerCase())?'collision':'absent',existingIds:rows.filter(r=>r.displayName.toLowerCase()===t.displayName.toLowerCase()).map(r=>r.id).sort()})),protectedExistingListCount:rows.length,connector:{connectionId,account:binding.username,connected:true,catalogueTargetVisible,writeExecutionVerified:false}};
  };
  const before=await pass(),after=await pass();phase='readback';await owned();if(JSON.stringify(before)!==JSON.stringify(after))throw Error();
  return{status:'observed',scope:'proposed-dedicated-target-and-writer-readiness',proposalSha256:sharepointHash(proposal),repoId,tenantId:binding.tenantId,username:binding.username,siteUrl:proposal.siteUrl,siteCollectionId:proposal.siteCollectionId,webId:proposal.webId,...after,schemaWriter:graph.schemaWriterIdentity??null,graphSchemaScopeObserved:graph.schemaWriteScopeObserved,requiredDelegatedSchemaScope:'Sites.Manage.All',writeApproved:false,writeExecutionVerified:false,limits:['Proposed targets only; existing resources cannot be adopted by name and collisions block creation','Token scope and connected catalogue reads do not establish effective write rights or operation licensing','Independent pinned design/task, exact resource ownership and permission/data-boundary/recovery evidence remain mandatory; no grants, writes or activation performed']};
 }catch(error){check();return{status:'unavailable',scope:'proposed-dedicated-target-and-writer-readiness',failurePhase:phase,providerStatus:error instanceof SharepointGraphHttpError?error.status:null,writeApproved:false,writeExecutionVerified:false,reason:'Pinned proposal, executing writer context, connector account, catalogue or target inventory unavailable/incomplete/changed; no login, fallback or tenant writes'};}
}
