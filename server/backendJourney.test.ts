import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {backendJourneySchema,verifyBackendJourney} from './backendJourney.ts';
import {PlatformCommandError} from './platformCommandError.ts';
import type {Request} from './targetOperations.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const id='11111111-1111-4111-8111-111111111111',binding={organizationId:id,userId:id},context={runId:id,sourceCommit:'b'.repeat(40)};
const plan=backendJourneySchema.parse({entitySet:'exp_reports',idField:'exp_reportid',nameField:'exp_title',maxNameLength:100,values:{exp_amount:0,exp_status:1},childEntitySet:'exp_lines',childLookup:'_exp_report_value',childIdField:'exp_lineid',validationErrorCodes:['0x80073001']});
it('refuses a generic invalid-argument error as proof of length validation',()=>{
 expect(()=>backendJourneySchema.parse({...plan,validationErrorCodes:['0x80040203']})).toThrow();
});
async function fixture(mode='normal'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'backend-journey-'));roots.push(root);let row:Record<string,unknown>|null=null,version=1;const writes:string[]=[];
 const request:Request=async(method,resource,body,headers)=>{
  if(resource==='WhoAmI')return {...binding,OrganizationId:id,UserId:mode==='wrong-user'?'22222222-2222-4222-8222-222222222222':id};
  if(method==='GET'){
   if(resource.startsWith('exp_lines?'))return {value:mode==='children'?[{exp_lineid:'unexpected'}]:[]};
   if(resource.startsWith('exp_reports?'))return {value:row?[{exp_reportid:row.exp_reportid}]:[]};
   return {...row,'@odata.etag':`W/"${version}"`,versionnumber:version};
  }
  writes.push(method);
  if(method==='POST'){if(mode==='ambiguous')throw new Error('Transport outcome unknown');if(mode.startsWith('revision')&&Object.hasOwn(body!,'exp_amount'))throw new Error('Derived total must not be authored');row={...(mode.startsWith('revision')?{exp_amount:0,exp_revision:0}:{}),...body,_ownerid_value:mode==='foreign'?'22222222-2222-4222-8222-222222222222':id};return null;}
  if(headers?.['If-Match']!==`W/"${version}"`)throw new Error('Concurrency token differs');
  if(method==='PATCH'){
   if(mode.startsWith('revision')&&(body as Record<string,unknown>).exp_expectedrevision!==row!.exp_revision)throw new Error('Service revision differs');
   const name=(body as Record<string,unknown>).exp_title as string;
   if(name.length>100){if(mode==='permission')throw new PlatformCommandError('Forbidden','0x80040220');if(mode==='corrupt')row!.exp_amount=123;if(mode==='revision-change')row!.exp_revision=Number(row!.exp_revision)+1;throw new PlatformCommandError('Metadata length validation','0x80073001');}
   row={...row,...body,...(mode.startsWith('revision')?{exp_revision:Number(row!.exp_revision)+1}:{})};version++;return null;
  }
  if(method==='DELETE'){row=null;return null;}
  throw new Error('Unexpected request');
 };return {root,request,writes};
}
it('creates only an owned GUID, proves fresh persistence and validation, restores business state and retains its audit record without deletion',async()=>{
 const f=await fixture();const result=await verifyBackendJourney(plan,binding,f.request,f.root,new AbortController().signal,context);
 expect(result.result).toMatchObject({scope:'pilot-owned-development-records',restored:true,dataPreserved:true,cleanup:'retained-for-audit'});expect(f.writes).toEqual(['POST','PATCH','PATCH','PATCH']);
 expect(result.result.protectedRecords[0].beforeSha256).toBe(result.result.protectedRecords[0].afterSha256);
 const count=f.writes.length;await verifyBackendJourney(plan,binding,f.request,f.root,new AbortController().signal,context);expect(f.writes).toHaveLength(count);
});
it.each(['wrong-user','foreign','permission','corrupt','children'])('refuses unsafe or unproven evidence: %s',async mode=>{
 const f=await fixture(mode);await expect(verifyBackendJourney(plan,binding,f.request,f.root,new AbortController().signal,context)).rejects.toThrow();
 expect(f.writes).not.toContain('DELETE');if(mode==='wrong-user')expect(f.writes).toEqual([]);
 const report=JSON.parse(await fs.readFile(path.join(f.root,'independent-journey-failure.json'),'utf8'));expect(report.failed).toBe(true);
});
it('does not repeat an ambiguous create or allow values to replace ownership markers',async()=>{
 const f=await fixture('ambiguous');await expect(verifyBackendJourney(plan,binding,f.request,f.root,new AbortController().signal,context)).rejects.toThrow('unknown');
 await expect(verifyBackendJourney(plan,binding,f.request,f.root,new AbortController().signal,context)).rejects.toThrow('reconcile');expect(f.writes).toEqual(['POST']);
 expect(()=>backendJourneySchema.parse({...plan,values:{exp_title:'forged'}})).toThrow('runner-owned');
});
it('supports server-derived totals and guarded service revisions without restoring audit counters',async()=>{
 const f=await fixture('revision');const contract=backendJourneySchema.parse({...plan,createValues:{exp_status:1},concurrency:{revisionField:'exp_revision',expectedRevisionField:'exp_expectedrevision'}});
 const result=await verifyBackendJourney(contract,binding,f.request,f.root,new AbortController().signal,context);expect(result.result.restored).toBe(true);expect(f.writes).not.toContain('DELETE');
});


it('rejects a service revision change even when an invalid write preserves the ETag',async()=>{const f=await fixture('revision-change');const contract=backendJourneySchema.parse({...plan,createValues:{exp_status:1},concurrency:{revisionField:'exp_revision',expectedRevisionField:'exp_expectedrevision'}});await expect(verifyBackendJourney(contract,binding,f.request,f.root,new AbortController().signal,context)).rejects.toThrow('Rejected write changed');expect(f.writes).not.toContain('DELETE');});
