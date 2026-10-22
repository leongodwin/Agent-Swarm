import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('./headlessAcceptedReport.ts',()=>({loadAcceptedHeadlessReport:h.load}));
import {DeliveryService} from './delivery.ts';
const roots:string[]=[];afterEach(async()=>{vi.resetAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
it.each(['accepted','missing-reader','missing-run','missing-release','changed-evidence','changed-acceptance','removed-run','removed-release','changed-after-read','revoked'])('rechecks server acceptance before and after private loading: %s',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'accepted-headless-authority-'));roots.push(root);const runId='11111111-1111-4111-8111-111111111111',releaseId='22222222-2222-4222-8222-222222222222',file='headless-0-receipt.json',directory=path.join(root,'delivery-runs',runId,'evidence');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,file),'synthetic accepted receipt');
 const evidenceHash=crypto.createHash('sha256').update(file).update('synthetic accepted receipt').digest('hex'),accepted={runId,evidenceHash};
 const service:any=new DeliveryService(root,false),source={id:runId,releaseId,evidence:[file]},release={id:releaseId};service.state.runs=[source];service.state.releases=[release];service.acceptedHeadlessSlice=()=>accepted;
 const plan:any={qaOwner:'independent-qa',verification:{headlessFlow:{dispatchReport:{sliceRunId:runId}}}},current:any={repoId:'synthetic/recruitment',environmentUrl:'https://test.crm.dynamics.com'},guard=vi.fn(async()=>{});
 h.load.mockImplementation(async()=>{if(mode==='changed-acceptance')accepted.evidenceHash='a'.repeat(64);if(mode==='removed-run')service.state.runs=[];if(mode==='removed-release')service.state.releases=[];if(mode==='changed-after-read')await fs.writeFile(path.join(directory,file),'changed after acceptance');return{report:'PRIVATE SYNTHETIC CONTENT'};});
 if(mode==='missing-reader')delete service.acceptedHeadlessSlice;if(mode==='missing-run')service.state.runs=[];if(mode==='missing-release')service.state.releases=[];if(mode==='changed-evidence')await fs.writeFile(path.join(directory,file),'changed before read');if(mode==='revoked')guard.mockRejectedValue(Error('Lease revoked'));
 const pending=service.acceptedReportFor(plan,current,new AbortController().signal,guard);
 if(mode==='accepted'){await expect(pending).resolves.toMatchObject({report:'PRIVATE SYNTHETIC CONTENT'});expect(h.load).toHaveBeenCalledWith(plan.verification.headlessFlow,expect.objectContaining({repoId:current.repoId,qaOwner:plan.qaOwner}),accepted,source,release,root,expect.any(AbortSignal),guard);}
 else await expect(pending).rejects.toThrow();
 if(['missing-reader','missing-run','missing-release','changed-evidence','revoked'].includes(mode))expect(h.load).not.toHaveBeenCalled();
});
it.each(['verified','missing-receipt','no-reports','unaccepted'])('publishes only bounded accepted-report metadata: %s',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'accepted-headless-metadata-'));roots.push(root);const runId='11111111-1111-4111-8111-111111111111',recordId='22222222-2222-4222-8222-222222222222',file='headless-0-receipt.json',directory=path.join(root,'delivery-runs',runId,'evidence'),body=JSON.stringify({privateReportSha256:'a'.repeat(64)});await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,file),body);
 const evidenceHash=crypto.createHash('sha256').update(file).update(body).digest('hex'),accepted={runId,evidenceHash},plan={privateReport:{recordId},flowId:recordId,definitionSha256:'b'.repeat(64),checks:[{mode:mode==='no-reports'?'empty':'dry-run',expectedStatus:'Succeeded',name:'Accepted live report'}]};
 const service:any=new DeliveryService(root,false);service.ready=true;const source={id:runId,releaseId:recordId,repoId:'synthetic/recruitment',evidence:mode==='missing-receipt'?[]:[file]};service.state.runs=[source];service.state.releases=[{id:recordId,plan:{verification:{headlessFlow:plan}}}];
 if(mode==='unaccepted')accepted.evidenceHash='f'.repeat(64);h.load.mockResolvedValue({report:'PRIVATE CONTENT NEVER RETURNED',reportSha256:'a'.repeat(64),providerRunId:'provider-observation'});
 const pending=service.acceptedHeadlessReports('synthetic/recruitment',recordId,'independent-qa','https://test.crm.dynamics.com',accepted,()=>{});
 if(mode==='verified'){const result=await pending;expect(result).toMatchObject({privateContentReturned:false,dispatchAuthorized:false,reports:[{sliceRunId:runId,checkName:'Accepted live report',reportSha256:'a'.repeat(64)}]});expect(JSON.stringify(result)).not.toContain('PRIVATE CONTENT');}
 else await expect(pending).rejects.toThrow();
});
