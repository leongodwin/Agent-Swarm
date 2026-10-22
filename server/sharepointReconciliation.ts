import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {atomicWrite} from './atomicFile.ts';
import {acceptResourceLeaseTransfer} from './resourceLease.ts';
import {SharepointProvisioning,sharepointPlan,sharepointHash,sharepointColumnBody,sameSubset,journalSchema,type SharepointPlan,type SharepointRequest} from './sharepointProvisioning.ts';

const sha=z.string().regex(/^[a-f0-9]{64}$/),guid=z.uuid();
const leaseSchema=z.strictObject({resource:z.string(),owner:z.string(),pid:z.number().int().positive(),token:guid,acquiredAt:z.iso.datetime()});
export const schemaReconciliationSpec=z.strictObject({schemaVersion:z.literal(1),originalSourceCommit:z.string().regex(/^[a-f0-9]{40,64}$/),originalPlan:z.record(z.string(),z.unknown()),journalBytes:z.string().max(65536),journalSha256:sha,leaseBytes:z.string().max(16384),leaseSha256:sha,resourceId:guid,metadata:z.record(z.string(),z.unknown()),metadataSha256:sha,quiescence:z.strictObject({ownerPid:z.number().int().positive(),sessions:z.literal(0),nativePids:z.array(z.number()).length(0),directGraphTransport:z.literal(true),stoppedAt:z.iso.datetime()})});
export type SchemaReconciliationSpec=z.infer<typeof schemaReconciliationSpec>;
const bytesHash=(b:Uint8Array|string)=>crypto.createHash('sha256').update(b).digest('hex');
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return(e as NodeJS.ErrnoException).code!=='ESRCH';}};
const entrySchema=journalSchema.shape.entries.element;
export const receiptSchema=z.strictObject({schemaVersion:z.literal(1),binding:z.strictObject({spec:schemaReconciliationSpec,planSha256:sha,authority:z.string().min(1).max(4000),entry:entrySchema}),phase:z.enum(['pending','applied']),oldJournalBytes:z.string(),oldLeaseBytes:z.string(),newJournalBytes:z.string(),newLeaseBytes:z.string()});
const strictBytes=async(file:string,max:number)=>{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Schema history path differs');const b=await readBoundedBytes(file,max);if(!b)throw Error('Schema history unavailable');return b;};
async function durable(file:string,bytes:string,guard:()=>void){guard();await atomicWrite(file,bytes,()=>{guard();return true;});const h=await fs.open(file,'r+');try{await h.sync();}finally{await h.close();}guard();}
export function schemaMetadata(site:unknown,list:Record<string,unknown>){const columns=[...(list.columns as Record<string,unknown>[])].sort((a,b)=>String(a.id??a.name).localeCompare(String(b.id??b.name)));return{site,list:{id:list.id,displayName:list.displayName,description:list.description,webUrl:list.webUrl,list:list.list},columns};}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export const schemaMetadataHash=(value:unknown)=>sharepointHash(canonical(value));

/** Only the observed first-parent text-facet correction is eligible. This is
 * not generic name adoption, lease reaping or arbitrary schema migration. */
export function validateSchemaReconciliation(raw:unknown,plan:SharepointPlan,repoId:string,owner:string,issue:number,record:{id:string;revision:number}){
 const s=schemaReconciliationSpec.parse(raw);
 if(bytesHash(s.journalBytes)!==s.journalSha256||bytesHash(s.leaseBytes)!==s.leaseSha256||schemaMetadataHash(s.metadata)!==s.metadataSha256)throw Error('Retained reconciliation snapshot digest differs');
 const old=structuredClone(s.originalPlan) as unknown as SharepointPlan;
 const normalized=structuredClone(old);for(const r of normalized.resources)for(const c of r.columns)if(c.kind==='text'&&c.multiline)delete c.maxLength;
 if(sharepointHash(sharepointPlan.parse(normalized))!==sharepointHash(plan)||sharepointHash(old)===sharepointHash(plan))throw Error('Only explicit native text-facet plan migration is supported');
 const journal=journalSchema.parse(parseUnambiguousJson(s.journalBytes,{maxBytes:65536})),lease=leaseSchema.parse(parseUnambiguousJson(s.leaseBytes,{maxBytes:16384}));
 const a=z.strictObject({scope:z.literal('independently-reviewed-schema-bootstrap'),repoId:z.string(),record:z.strictObject({id:guid,revision:z.number().int(),sha256:sha}),sourceAuthority:sha,issue:z.number().int(),actor:z.string(),planSha256:sha}).parse(parseUnambiguousJson(journal.authority,{maxBytes:4000}));
 const siteId=`${new URL(plan.siteUrl).hostname},${plan.siteCollectionId},${plan.webId}`,resource=`sharepoint:${plan.tenantId.toLowerCase()}:${siteId.toLowerCase()}`,entry=journal.entries[0];
 if(journal.planSha256!==sharepointHash(old)||a.planSha256!==journal.planSha256||a.repoId!==repoId||a.actor!==owner||a.issue!==issue||a.record.id!==record.id||a.record.revision>=record.revision||lease.owner!==journal.authority||lease.resource!==resource||lease.pid!==s.quiescence.ownerPid||Date.parse(s.quiescence.stoppedAt)>Date.now()+60000)throw Error('Original schema owner, record, source or lease differs');
 if(journal.entries.length!==1||entry.key!==plan.resources[0].key||entry.status!=='dispatched'||entry.migration||entry.id&&entry.id!==s.resourceId||!entry.marker.startsWith(`CubeFarm:${journal.planSha256}:`)||plan.resources[0].template!=='genericList'||plan.resources[0].columns.some(c=>c.kind==='lookup'))throw Error('Only the retained first dispatched parent can be reconciled');
 const oldColumns=old.resources[0].columns.map(c=>c.kind==='text'?{name:c.name,required:c.required,text:{allowMultipleLines:c.multiline,maxLength:c.maxLength,textType:'plain'}}:sharepointColumnBody(c));
 if(entry.payloadSha256!==sharepointHash({displayName:old.resources[0].displayName,description:entry.marker,list:{template:'genericList'},columns:oldColumns}))throw Error('Original dispatched payload digest differs');
 const metadata=s.metadata as any,columns=metadata.columns as Record<string,unknown>[];if(!Array.isArray(columns)||metadata.list?.id!==s.resourceId||metadata.list.description!==entry.marker||metadata.list.displayName!==plan.resources[0].displayName||metadata.list.list?.template!=='genericList'||metadata.site?.id.toLowerCase()!==siteId.toLowerCase()||metadata.site.webUrl!==plan.siteUrl||metadata.site.sharepointIds?.tenantId.toLowerCase()!==plan.tenantId.toLowerCase())throw Error('Owned provider resource differs');
 const u=new URL(metadata.list.webUrl),base=new URL(plan.siteUrl);if(u.origin!==base.origin||!u.pathname.startsWith(base.pathname+'/')||u.search||u.hash||u.username||u.password)throw Error('Owned resource escaped site');
 for(const c of plan.resources[0].columns)if(columns.filter(x=>x.name===c.name).length!==1||!sameSubset(columns.find(x=>x.name===c.name),sharepointColumnBody(c)))throw Error('Owned resource does not match revised exact schema');
 const nextEntry={...entry,status:'verified' as const,id:s.resourceId,payloadSha256:sharepointHash({displayName:plan.resources[0].displayName,description:entry.marker,list:{template:'genericList'},columns:plan.resources[0].columns.map(c=>sharepointColumnBody(c))})};
 return{s,old,journal,lease,resource,siteId,nextEntry};
}

export async function reconcileSchemaIntent(input:{root:string;leaseRoot:string;repoId:string;owner:string;issue:number;record:{id:string;revision:number};plan:SharepointPlan;spec:unknown;authority:string;request:SharepointRequest;guard():void;authorize():Promise<void>},deps:{alive?:(pid:number)=>boolean;checkpoint?:(phase:string)=>Promise<void>}={}){
 const v=validateSchemaReconciliation(input.spec,input.plan,input.repoId,input.owner,input.issue,input.record),check=async()=>{input.guard();await input.authorize();if((deps.alive??alive)(v.lease.pid))throw Error('Original schema owner is still alive; no handoff');input.guard();};
 await check();
 const observe=async()=>{const inv=await new SharepointProvisioning(input.root,input.leaseRoot).inventory(input.plan.siteUrl,input.plan.tenantId,async(method,route)=>{if(method!=='GET')throw Error('Reconciliation forbids remote writes');await check();const r=await input.request('GET',route);await check();return r;},input.guard);const matches=inv.lists.filter(l=>l.id===v.s.resourceId||l.description===v.journal.entries[0].marker);if(matches.length!==1||schemaMetadataHash(schemaMetadata(inv.site,matches[0]))!==v.s.metadataSha256)throw Error('Fresh provider metadata differs from reviewed reconciliation');};
 await observe();await observe();await check();
 const leaseFile=path.join(input.leaseRoot,bytesHash(v.resource)+'.json'),journalFile=path.join(input.leaseRoot,'sharepoint-history',sharepointHash(v.siteId.toLowerCase())+'.json'),lock=leaseFile+'.reaping';
 const snapshots=async()=>{await check();if(bytesHash(await strictBytes(leaseFile,16384))!==v.s.leaseSha256||bytesHash(await strictBytes(journalFile,65536))!==v.s.journalSha256)throw Error('Retained schema lease or journal changed');};
 await fs.mkdir(lock).catch(()=>{throw Error('Schema handoff/recovery already in progress');});let pending=false;
 try{
  await snapshots();await deps.checkpoint?.('locked');
  const binding={spec:v.s,planSha256:sharepointHash(input.plan),authority:input.authority,entry:v.nextEntry},receiptSha256=sharepointHash(binding),receiptFile=path.join(input.leaseRoot,'sharepoint-reconciliations',receiptSha256+'.json');
  if(await fs.lstat(receiptFile).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Existing reconciliation requires independent recovery');
  const nextJournal={planSha256:binding.planSha256,authority:input.authority,entries:[{...v.nextEntry,migration:receiptSha256}]},nextLease={resource:v.resource,owner:input.authority,pid:process.pid,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()},newLeaseBytes=JSON.stringify(nextLease);
  const receipt={schemaVersion:1 as const,binding,phase:'pending' as const,oldJournalBytes:v.s.journalBytes,oldLeaseBytes:v.s.leaseBytes,newJournalBytes:JSON.stringify(nextJournal),newLeaseBytes};
  await snapshots();pending=true;await durable(receiptFile,JSON.stringify(receipt),input.guard);await deps.checkpoint?.('pending');await snapshots();
  await durable(journalFile,receipt.newJournalBytes,input.guard);await deps.checkpoint?.('journal');await check();if(bytesHash(await strictBytes(leaseFile,16384))!==v.s.leaseSha256)throw Error('Lease changed before handoff');
  await durable(leaseFile,newLeaseBytes,input.guard);await deps.checkpoint?.('lease');await check();
  if((await strictBytes(journalFile,65536)).toString()!==receipt.newJournalBytes||(await strictBytes(leaseFile,16384)).toString()!==newLeaseBytes)throw Error('Published handoff state differs');
  await durable(receiptFile,JSON.stringify({...receipt,phase:'applied'}),input.guard);await deps.checkpoint?.('applied');await check();await fs.rmdir(lock);pending=false;
  return{receiptFile,receiptSha256,lease:await acceptResourceLeaseTransfer(input.leaseRoot,v.resource,input.authority,bytesHash(newLeaseBytes))};
 }finally{if(!pending)await fs.rmdir(lock).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

export async function verifySchemaLineage(leaseRoot:string,plan:SharepointPlan,authority:string,entry:z.infer<typeof entrySchema>,guard:()=>void){
 guard();if(!entry.migration)throw Error('Schema migration proof missing');const file=path.join(leaseRoot,'sharepoint-reconciliations',entry.migration+'.json'),receipt=receiptSchema.parse(parseUnambiguousJson((await strictBytes(file,128*1024)).toString(),{maxBytes:128*1024}));
 if(receipt.phase!=='applied'||sharepointHash(receipt.binding)!==entry.migration||receipt.binding.planSha256!==sharepointHash(plan)||receipt.binding.authority!==authority||JSON.stringify({...entry,migration:undefined})!==JSON.stringify(receipt.binding.entry))throw Error('Schema migration lineage differs');
 const a=JSON.parse(authority);validateSchemaReconciliation(receipt.binding.spec,plan,a.repoId,a.actor,a.issue,a.record);guard();
}
