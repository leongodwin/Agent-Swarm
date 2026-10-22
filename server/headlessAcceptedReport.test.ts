import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {headlessFlowSchema} from './headlessFlowVerification.ts';
import {loadAcceptedHeadlessReport} from './headlessAcceptedReport.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const ids={flow:'11111111-1111-4111-8111-111111111111',record:'22222222-2222-4222-8222-222222222222',run:'33333333-3333-4333-8333-333333333333',release:'44444444-4444-4444-8444-444444444444',nonce:'55555555-5555-4555-8555-555555555555'};
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'accepted-headless-report-'));roots.push(home);
 const leaf=path.join(home,'private'),evidence=path.join(home,'delivery-runs',ids.run,'evidence');await fs.mkdir(leaf);await fs.mkdir(evidence,{recursive:true});
 const report='<p>PRIVATE SYNTHETIC REPORT — ✓</p>',reportSha256=hash(report),definitionSha256='a'.repeat(64),evidenceHash='b'.repeat(64);
 const checks=['dry-run','recipient-denied','attachment-fallback','retry-recovery','retry-exhaustion','dispatch'].map((mode,i)=>({name:i===0?'Accepted live candidate':'Test '+mode,identity:'owner',criterion:i,category:mode==='recipient-denied'?'authorization':mode.includes('retry')||mode.includes('attachment')?'error-handling':'journey',mode,expectedStatus:mode==='recipient-denied'||mode==='retry-exhaustion'?'Failed':'Succeeded',assertions:[{pointer:['ok'],equals:true}]}));
 const plan=headlessFlowSchema.parse({flowId:ids.flow,identity:{tenantId:ids.record,environmentId:ids.release,username:'owner@example.test'},definitionSha256,privateReport:{recordId:ids.record,action:'Private_report'},contextAction:'Run_context',resultAction:'Verification_result',sendAction:'Send_report',receiptAction:'Read_receipt',allowDispatch:true,dispatchKey:ids.record,dispatchReport:{sliceRunId:ids.run,checkName:checks[0].name,reportSha256},checks});
 const prior=headlessFlowSchema.parse({...plan,allowDispatch:false,dispatchReport:undefined,dispatchKey:undefined,receiptAction:undefined,checks:plan.checks.slice(0,-1)});
 const context={repoId:'synthetic/recruitment',environmentUrl:'https://test.crm.dynamics.com',qaOwner:'independent-qa'};
 const source:any={id:ids.run,repoId:context.repoId,head:'c'.repeat(40),releaseId:ids.release,phase:'complete',environmentUrl:context.environmentUrl,evidenceHash,evidence:['headless-0-receipt.json'],visualReview:{reviewer:context.qaOwner,evidenceHash}};
 const release:any={id:ids.release,repoId:context.repoId,head:source.head,environmentUrl:context.environmentUrl,plan:{deliveryRecord:{id:ids.record,purpose:'slice'},verification:{headlessFlow:prior}}};
 const receipt=path.join(evidence,'headless-0-receipt.json'),capture=path.join(leaf,ids.nonce+'.report.json');
 await fs.writeFile(receipt,JSON.stringify({intent:{flowId:ids.flow,definitionSha256,nonce:ids.nonce,check:prior.checks[0]},runId:'real-provider-id-in-synthetic-test',privateReportSha256:reportSha256}));
 const stored={schemaVersion:1,recordId:ids.record,flowId:ids.flow,runId:'real-provider-id-in-synthetic-test',owner:plan.identity.username,report};await fs.writeFile(capture,JSON.stringify(stored));
 const accepted={runId:ids.run,evidenceHash},guard=vi.fn(async()=>{}),metadata:any=vi.fn(async()=>({status:'observed',protectedOwnerOnly:true,leaf}));
 return{home,leaf,plan,source,release,accepted,context,guard,metadata,report,stored,capture,receipt,load:()=>loadAcceptedHeadlessReport(plan,context,accepted,source,release,home,new AbortController().signal,guard,metadata)};
}
it('selects one exact reviewed dry-run and returns its private content only to the runner',async()=>{const f=await fixture();expect(await f.load()).toMatchObject({sliceRunId:ids.run,checkName:'Accepted live candidate',reportSha256:hash(f.report),report:f.report});expect(f.metadata).toHaveBeenCalledTimes(2);expect(await fs.readdir(f.leaf)).toEqual([ids.nonce+'.report.json']);expect(await fs.readFile(f.receipt,'utf8')).not.toContain(f.report);});
it.each(['capture-tamper','wrong-env','wrong-owner','wrong-native-run','review','incomplete','unaccepted-run','wrong-check','wrong-hash','definition','moved-leaf','hardlink','invalid-utf8','missing-capture','quality-review','wrong-source-record','bad-receipt','missing-evidence','non-string-report','unprotected'])('holds dispatch on %s without changing captures or acceptance',async mode=>{
 const f=await fixture();
 if(mode==='capture-tamper'){f.stored.report='Different content';await fs.writeFile(f.capture,JSON.stringify(f.stored));}
 if(mode==='wrong-env')f.source.environmentUrl='https://foreign.crm.dynamics.com';
 if(mode==='wrong-owner'){f.stored.owner='other@example.test';await fs.writeFile(f.capture,JSON.stringify(f.stored));}
 if(mode==='wrong-native-run'){f.stored.runId='another-run';await fs.writeFile(f.capture,JSON.stringify(f.stored));}
 if(mode==='review')f.source.visualReview.evidenceHash='d'.repeat(64);
 if(mode==='incomplete')f.source.phase='reviewing';
 if(mode==='unaccepted-run')f.accepted.runId=ids.flow;
 if(mode==='wrong-check')f.plan.dispatchReport!.checkName='Unknown dry-run';
 if(mode==='wrong-hash')f.plan.dispatchReport!.reportSha256='e'.repeat(64);
 if(mode==='definition')f.release.plan.verification.headlessFlow.definitionSha256='f'.repeat(64);
 if(mode==='moved-leaf'){let reads=0;f.metadata.mockImplementation(async()=>({status:'observed',protectedOwnerOnly:true,leaf:++reads===1?f.leaf:path.join(f.leaf,'changed')}));}
 if(mode==='hardlink')await fs.link(f.capture,path.join(f.home,'duplicate-link'));
 if(mode==='invalid-utf8')await fs.writeFile(f.capture,Buffer.from([0xc3,0x28]));
 if(mode==='missing-capture')await fs.unlink(f.capture);
 if(mode==='quality-review')f.release.plan.qualityEvidence={};
 if(mode==='wrong-source-record')f.release.plan.deliveryRecord.id=ids.flow;
 if(mode==='bad-receipt')await fs.writeFile(f.receipt,'{"runId":"duplicate","runId":"duplicate"}');
 if(mode==='missing-evidence')f.source.evidence=[];
 if(mode==='non-string-report'){(f.stored as any).report={html:f.report};await fs.writeFile(f.capture,JSON.stringify(f.stored));}
 if(mode==='unprotected')f.metadata.mockResolvedValue({status:'observed',protectedOwnerOnly:false,leaf:f.leaf});
 const before=JSON.stringify(f.accepted);await expect(f.load()).rejects.toThrow('accepted private report');expect(JSON.stringify(f.accepted)).toBe(before);
});
it('never continues after cancellation or ownership revocation',async()=>{const f=await fixture(),controller=new AbortController();controller.abort();await expect(loadAcceptedHeadlessReport(f.plan,f.context,f.accepted,f.source,f.release,f.home,controller.signal,f.guard,f.metadata)).rejects.toThrow();expect(f.metadata).not.toHaveBeenCalled();f.guard.mockRejectedValue(Error('Lease revoked'));await expect(f.load()).rejects.toThrow('Lease revoked');});
it.each(['duplicate-check','failed-dry-run','already-dispatching','foreign-source-repo','foreign-release-repo','foreign-release-env','foreign-reviewer','foreign-identity','foreign-flow','foreign-report-record','foreign-report-action','different-head','oversized-capture','oversized-report','empty-report','capture-directory'])('refuses ambiguous or foreign accepted-output provenance: %s',async mode=>{
 const f=await fixture(),prior=f.release.plan.verification.headlessFlow;
 if(mode==='duplicate-check')prior.checks.push({...prior.checks[0]});
 if(mode==='failed-dry-run')prior.checks[0].expectedStatus='Failed';
 if(mode==='already-dispatching')prior.allowDispatch=true;
 if(mode==='foreign-source-repo')f.source.repoId='foreign/project';
 if(mode==='foreign-release-repo')f.release.repoId='foreign/project';
 if(mode==='foreign-release-env')f.release.environmentUrl='https://foreign.crm.dynamics.com';
 if(mode==='foreign-reviewer')f.source.visualReview.reviewer='author';
 if(mode==='foreign-identity')prior.identity.username='other@example.test';
 if(mode==='foreign-flow')prior.flowId=ids.record;
 if(mode==='foreign-report-record')prior.privateReport.recordId=ids.flow;
 if(mode==='foreign-report-action')prior.privateReport.action='Unreviewed_output';
 if(mode==='different-head')f.source.head='d'.repeat(40);
 if(mode==='oversized-capture')await fs.writeFile(f.capture,'x'.repeat(300001));
 if(mode==='oversized-report'){f.stored.report='x'.repeat(256001);await fs.writeFile(f.capture,JSON.stringify(f.stored));}
 if(mode==='empty-report'){f.stored.report='';await fs.writeFile(f.capture,JSON.stringify(f.stored));}
 if(mode==='capture-directory'){await fs.unlink(f.capture);await fs.mkdir(f.capture);}
 await expect(f.load()).rejects.toThrow('accepted private report');
});
it('requires the accepted quality decision when the slice declares quality evidence',async()=>{const f=await fixture();f.release.plan.qualityEvidence={};f.source.qualityReview={reviewer:f.context.qaOwner,evidenceHash:f.accepted.evidenceHash};await expect(f.load()).resolves.toMatchObject({report:f.report});f.source.qualityReview.evidenceHash='f'.repeat(64);await expect(f.load()).rejects.toThrow('accepted private report');});
it.each(['whitespace','unpaired-surrogate'])('rejects %s content even when the retained hashes match',async mode=>{const f=await fixture();f.stored.report=mode==='whitespace'?' \r\n\t ':'\ud800';const sha=hash(f.stored.report);f.plan.dispatchReport!.reportSha256=sha;const receipt=JSON.parse(await fs.readFile(f.receipt,'utf8'));receipt.privateReportSha256=sha;await fs.writeFile(f.receipt,JSON.stringify(receipt));await fs.writeFile(f.capture,JSON.stringify(f.stored));await expect(f.load()).rejects.toThrow('accepted private report');});
