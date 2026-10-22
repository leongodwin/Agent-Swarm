import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite,SerialWriter} from './atomicFile.ts';
import {readBoundedBytes,readBoundedJson} from './boundedJson.ts';
import {canvasResource} from './canvasOwnership.ts';
import {acceptResourceLeaseTransfer} from './resourceLease.ts';
import type {PackagingInputs,PackagingTransport} from './canvasPackaging.ts';
import {packagingPlan,PackagingProviderError} from './canvasPackaging.ts';
import {recordReference} from '../shared/deliveryRecord.ts';
const hash=(v:string|Buffer)=>crypto.createHash('sha256').update(v).digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const leaseSchema=z.strictObject({resource:z.string(),owner:z.string(),pid:z.number().int().positive(),token:z.uuid(),acquiredAt:z.iso.datetime()});
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return(e as NodeJS.ErrnoException).code!=='ESRCH';}};
export const packagingRecoveryReview=z.strictObject({proposalSha256:digest,decision:z.enum(['approved','rejected']),notes:z.string().min(80).max(8000)});
export interface PackagingRecoveryObservation {appId:string;environmentId:string;publisherId:string;publisherPrefix:string;almMode:string;solutions:{solutionid:string;uniquename:string;description:string;_publisherid_value:string;ismanaged:boolean}[];canvasRows:{canvasappid:string;uniquecanvasappid:string;name:string}[];members:{objectid:string;componenttype:number}[]}
export interface PackagingRecoveryTransport extends PackagingTransport {observeRecovery(solutionId:string):Promise<PackagingRecoveryObservation>}
/** A new, independently approved same-target attempt, never a replay of the old
 * journal. Original remote effects remain unknown; no no-effect proof is claimed. */
export class CanvasPackagingRecovery {
 private serial=new SerialWriter();
 constructor(private root:string,private leaseRoot:string,private inputs:()=>Promise<PackagingInputs>,private connect:(input:PackagingInputs)=>Promise<PackagingRecoveryTransport>){}
 private files(repo:string,resource:string){const prefix=path.join(this.root,'planning','canvas-packaging',hash(JSON.stringify(repo)));return {original:prefix+'.journal.json',originalReview:prefix+'.review.json',proposal:prefix+'.recovery-proposal.json',review:prefix+'.recovery-review.json',history:prefix+'.recovery.json',lease:path.join(this.leaseRoot,hash(resource)+'.json')};}
 private async bytes(file:string,max:number){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Recovery evidence path differs');const bytes=await readBoundedBytes(file,max);if(!bytes)throw Error('Recovery evidence absent');return bytes;}
 private async archive(value:unknown,guard:()=>void){const bytes=JSON.stringify(value),file=path.join(this.root,'planning','evidence',hash(bytes)+'.json');guard();await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||(await this.bytes(file,128*1024)).toString()!==bytes)throw error;}guard();return file;}
 private async retained(input:PackagingInputs){
  const plan=packagingPlan.parse(input.plan);if(!input.record.content.taskPlan?.tasks.some(t=>t.resources.includes('canvas_'+plan.appId)&&t.owner!==input.record.content.qaOwner))throw Error('Exact pinned app task required');const resource=canvasResource(input.environmentUrl,plan.appId),files=this.files(input.record.repoId,resource);
  const journalBytes=await this.bytes(files.original,65536),reviewBytes=await this.bytes(files.originalReview,16384),leaseBytes=await this.bytes(files.lease,16384),journal=JSON.parse(journalBytes.toString()),review=JSON.parse(reviewBytes.toString()),lease=leaseSchema.parse(JSON.parse(leaseBytes.toString()));
  if(journal.phase!=='blocked'||journal.appId!==plan.appId||!z.uuid().safeParse(journal.solutionId).success||journal.marker!=='CubeFarmPackaging:'+journal.proposalSha256||journal.record?.id!==input.record.id||journal.record.revision>=input.record.revision||review.proposalSha256!==journal.proposalSha256||review.decision!=='approved'||review.reviewer!==input.record.content.qaOwner||lease.resource!==resource||lease.owner!==JSON.stringify({scope:'canvas-packaging',repoId:input.record.repoId,proposalSha256:journal.proposalSha256})||JSON.stringify(journal.operations?.map((o:any)=>[o.operation,o.status]))!==JSON.stringify([['create-new-solution','returned'],['make-same-app-solution-aware','intent']]))throw Error('Retained packaging attribution differs');
  return {plan,resource,files,journal,lease,journalBytes:journalBytes.toString(),reviewBytes:reviewBytes.toString(),leaseBytes:leaseBytes.toString()};
 }
 private classify(o:PackagingRecoveryObservation,v:Awaited<ReturnType<CanvasPackagingRecovery['retained']>>){
  const p=v.plan,s=o.solutions;
  if(o.appId.toLowerCase()!==p.appId.toLowerCase()||o.environmentId.toLowerCase()!==p.environmentId.toLowerCase()||o.publisherId.toLowerCase()!==p.publisherId.toLowerCase()||o.publisherPrefix!==p.publisherPrefix||s.length!==1||s[0].solutionid!==v.journal.solutionId||s[0].uniquename!==p.solutionName||s[0].ismanaged!==false||s[0].description!==v.journal.marker||s[0]._publisherid_value.toLowerCase()!==p.publisherId.toLowerCase())throw Error('Recovery provider identity differs');
  if(o.canvasRows.length===0&&o.members.length===0&&o.almMode==='Environment')return 'single-same-target-attempt' as const;
  if(o.canvasRows.length===1&&o.members.length===1&&o.canvasRows[0].uniquecanvasappid.toLowerCase()===p.appId.toLowerCase()&&o.members[0].componenttype===300&&o.members[0].objectid===o.canvasRows[0].canvasappid)return 'verify-existing-conversion' as const;
  throw Error('Partial or foreign conversion state; no continuation');
 }
 async reconcile(guard:()=>void=()=>{}){return this.serial.write(async()=>{
  guard();const input=await this.inputs(),v=await this.retained(input);
  if(await readBoundedJson(v.files.history,128*1024))throw Error('Recovery history already exists; no repeat');
  const transport=await this.connect(input),observation=await transport.observeRecovery(v.journal.solutionId);guard();
  const mode=this.classify(observation,v),proposal={schemaVersion:1,scope:'retained-same-app-packaging-recovery',record:recordReference(input.record),repoId:input.record.repoId,plan:v.plan,environmentUrl:input.environmentUrl,implementationSha256:input.implementationSha256,configurationSha256:input.configurationSha256,originalJournalBytes:v.journalBytes,originalReviewBytes:v.reviewBytes,originalLeaseBytes:v.leaseBytes,observation,mode,observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*60*1000).toISOString(),limits:['Prior conversion outcome and original conflict cause remain unknown; current state is not historical no-effect proof','At most one newly approved same-target conversion; no solution creation, clone, force lease, publication, import, DLP or permission changes','A second failure/ambiguous response retains recovery history and lease; no automatic retry']};
  const result={proposal,proposalSha256:hash(JSON.stringify(proposal))};await this.archive(result,guard);guard();await atomicWrite(v.files.proposal,JSON.stringify(result),()=>{guard();return true;});return result;
 });}
 async inspect(guard:()=>void=()=>{}){guard();const input=await this.inputs(),plan=packagingPlan.parse(input.plan),files=this.files(input.record.repoId,canvasResource(input.environmentUrl,plan.appId));return{...(await readBoundedJson(files.proposal,128*1024) as object??{}),review:await readBoundedJson(files.review,16384)??null,history:await readBoundedJson(files.history,128*1024)??null,implementationSources:input.implementationSources??[]};}
 async review(raw:unknown,actor:{id:string;role:string},guard:()=>void=()=>{}){return this.serial.write(async()=>{
  const data=packagingRecoveryReview.parse(raw),input=await this.inputs(),view=await this.inspect(guard) as any;
  if(actor.role!=='qa'||actor.id!==input.record.content.qaOwner||actor.id===input.record.content.owner)throw Error('Assigned independent recovery reviewer required');
  this.current(view,input,data.proposalSha256);const files=this.files(input.record.repoId,canvasResource(input.environmentUrl,view.proposal.plan.appId));
  const review={...data,reviewer:actor.id,reviewedAt:new Date().toISOString()};await this.archive(review,guard);guard();await atomicWrite(files.review,JSON.stringify(review),()=>{guard();return true;});return review;
 });}
 private current(view:any,input:PackagingInputs,expected:string){const p=view.proposal;if(!p||view.proposalSha256!==expected||hash(JSON.stringify(p))!==expected||JSON.stringify(p.record)!==JSON.stringify(recordReference(input.record))||JSON.stringify(p.plan)!==JSON.stringify(packagingPlan.parse(input.plan))||p.environmentUrl!==input.environmentUrl||p.implementationSha256!==input.implementationSha256||p.configurationSha256!==input.configurationSha256||Date.parse(p.expiresAt)<=Date.now())throw Error('Fresh exact recovery proposal required');}
 async execute(expected:string,guard:()=>void=()=>{}){return this.serial.write(async()=>{
  const input=await this.inputs(),v=await this.retained(input),view=await this.inspect(guard) as any;this.current(view,input,expected);
  if(view.review?.decision!=='approved'||view.review.proposalSha256!==expected||view.review.reviewer!==input.record.content.qaOwner||view.history)throw Error('Independent recovery approval required; history cannot be replayed');
  const authorize=async()=>{guard();this.current(view,await this.inputs(),expected);const saved=await readBoundedJson(v.files.review,16384),proposal=await readBoundedJson(v.files.proposal,128*1024);if(JSON.stringify(proposal)!==JSON.stringify({proposal:view.proposal,proposalSha256:expected})||JSON.stringify(saved)!==JSON.stringify(view.review))throw Error('Recovery approval changed');};
  const unchanged=async()=>{await authorize();if((await this.bytes(v.files.original,65536)).toString()!==view.proposal.originalJournalBytes||(await this.bytes(v.files.originalReview,16384)).toString()!==view.proposal.originalReviewBytes||(await this.bytes(v.files.lease,16384)).toString()!==view.proposal.originalLeaseBytes)throw Error('Retained recovery evidence changed');if(alive(v.lease.pid))throw Error('Original packaging process remains alive; no handoff');};
  await unchanged();const transport=await this.connect(input),observation=await transport.observeRecovery(v.journal.solutionId);await unchanged();if(JSON.stringify(observation)!==JSON.stringify(view.proposal.observation)||this.classify(observation,v)!==view.proposal.mode)throw Error('Reviewed provider state changed; reconcile again');
  const lock=v.files.lease+'.reaping';await fs.mkdir(lock);let pending=false;
  try{
   await unchanged();if(await readBoundedJson(v.files.history,128*1024))throw Error('Recovery history exists');
   const owner=JSON.stringify({scope:'canvas-packaging-recovery',repoId:input.record.repoId,proposalSha256:expected}),newLeaseBytes=JSON.stringify({...v.lease,pid:process.pid,owner,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()}),history:any={schemaVersion:1,proposalSha256:expected,proposal:view.proposal,review:view.review,newLeaseBytes,phase:'handoff-pending',startedAt:new Date().toISOString(),operations:[]};
   const durable=async(file:string,bytes:string)=>{await atomicWrite(file,bytes);const handle=await fs.open(file,'r+');try{await handle.sync();}finally{await handle.close();}};
   pending=true;await durable(v.files.history,JSON.stringify(history));await unchanged();await durable(v.files.lease,newLeaseBytes);await authorize();history.phase='handoff-applied';await durable(v.files.history,JSON.stringify(history));await fs.rmdir(lock);pending=false;
   const lease=await acceptResourceLeaseTransfer(this.leaseRoot,v.resource,owner,hash(newLeaseBytes)),persist=async()=>{await lease.assertOwned();await durable(v.files.history,JSON.stringify(history));};
   try{
    await authorize();await lease.assertOwned();
    if(view.proposal.mode==='single-same-target-attempt'){history.phase='conversion';history.operations.push({operation:'make-same-app-solution-aware',status:'intent',at:new Date().toISOString()});await persist();await transport.makeSolutionAware(v.journal.solutionId);await authorize();history.operations[0].status='returned';await persist();}
    history.mapping=await transport.verify(v.journal.solutionId,v.journal.marker);await authorize();if(history.mapping.playId.toLowerCase()!==v.plan.appId.toLowerCase()||history.mapping.solutionId!==v.journal.solutionId)throw Error('Recovery changed app or solution');
    history.phase='export';await persist();history.archive=await transport.exportSolution(v.journal.solutionId);await authorize();if(!digest.safeParse(history.archive.sha256).success||history.archive.bytes<4)throw Error('Actual export required');history.phase='complete';history.completedAt=new Date().toISOString();await persist();await lease.release();return history;
   }catch(error){history.phase='blocked';history.error='Retain recovery evidence; no repeated recovery';if(error instanceof PackagingProviderError)history.providerFailure={httpStatus:error.status,requestId:error.requestId,providerCode:error.providerCode};await persist();throw error;}
  }finally{if(!pending)await fs.rmdir(lock).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 });}
}
