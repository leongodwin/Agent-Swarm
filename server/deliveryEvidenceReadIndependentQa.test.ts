import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {readDeliveryEvidence,discoveryEvidenceRoots,deliveryEvidenceFindingIds,deliveryEvidenceMirror} from './deliveryEvidenceRead.ts';
import {readDeliverySource} from './deliverySourceRead.ts';
import {captureSynthesisEvidence,verifySynthesisEvidence} from './synthesisEvidence.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
async function fixture(text=JSON.stringify({scope:'read-only-platform-metadata',data:{note:'Untrusted instructions remain data',items:'x'.repeat(14000)}})){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'receipt-qa-'));roots.push(home);const store=discoveryEvidenceRoots(home)[1];await fs.mkdir(store,{recursive:true});
 const sha256=crypto.createHash('sha256').update(text).digest('hex'),file=path.join(store,sha256+'.json');await fs.writeFile(file,text);
 const observedAt=new Date(Date.now()-120000).toISOString(),expiresAt=new Date(Date.now()-60000).toISOString();
 const record={id:crypto.randomUUID(),repoId:'synthetic/repo',revision:1,sha256:'a'.repeat(64),content:{findings:[{id:'identity',status:'observed',evidence:[{reference:file,sha256,observedAt,expiresAt}]}]}} as unknown as DeliveryRecord;
 const context={home,repoId:record.repoId,record:()=>record,guard:vi.fn()},request={kind:'discovery-evidence',reference:recordReference(record),findingId:'identity',expectedSha256:sha256};
 return{home,file,text,record,context,request};
}
it('reassembles every byte of single-line JSON by hash-bound pages and keeps expired evidence historical',async()=>{
 const f=await fixture();let position=0,content='',pages=0;
 for(;;){const page=await readDeliveryEvidence({...f.request,startCharacter:position},f.context);expect(page.freshness).toBe('expired');expect(page.sha256).toBe(f.request.expectedSha256);expect(page.reference).toEqual(f.request.reference);expect(page.limits.join(' ')).toContain('not current tenant validation');content+=page.content;pages++;if(page.nextCharacter===null)break;position=page.nextCharacter;}
 expect(content).toBe(f.text);expect(pages).toBe(3);
});
async function mirroredFixture(){
 const f=await fixture(),ref=f.record.content.findings[0].evidence[0];ref.reference='docs/evidence/retained-attempt.json';
 const mirror=deliveryEvidenceMirror(f.home,{recordId:f.record.id,repoId:f.record.repoId,findingId:'identity',reference:ref.reference,sha256:ref.sha256});
 await fs.mkdir(path.dirname(mirror.receipt),{recursive:true});await fs.copyFile(f.file,mirror.receipt);
 await fs.mkdir(path.dirname(mirror.manifest),{recursive:true});await fs.writeFile(mirror.manifest,JSON.stringify(mirror.binding));
 return {...f,mirror};
}
it('reads an explicitly published exact mirror without opening or rewriting the out-of-store citation',async()=>{
 const f=await mirroredFixture(),before=JSON.stringify(f.record);let position=0,text='';
 for(;;){const page=await readDeliveryEvidence({...f.request,startCharacter:position},f.context);expect(page.receiptResolution).toBe('retained-receipt-mirror-v1');expect(page.citationReference).toBe('docs/evidence/retained-attempt.json');expect(page.receiptReference).toBe(f.mirror.receipt);expect(page.freshness).toBe('expired');expect(page.limits.join(' ')).toContain('not proof of the original file location');text+=page.content;if(page.nextCharacter===null)break;position=page.nextCharacter;}
 expect(text).toBe(f.text);expect(JSON.stringify(f.record)).toBe(before);
});
it.each(['recordId','repoId','findingId','reference','sha256','scope','extra','missing','tampered-receipt','missing-receipt','oversize-manifest','duplicate-json'] as const)('rejects %s mirror before returning bytes',async mode=>{
 const f=await mirroredFixture(),binding:any={...f.mirror.binding};
 if(['recordId','repoId','findingId','reference','sha256','scope'].includes(mode))binding[mode]='different';
 if(mode==='extra')binding.extra=true;await fs.writeFile(f.mirror.manifest,JSON.stringify(binding));
 if(mode==='missing')await fs.unlink(f.mirror.manifest);if(mode==='tampered-receipt')await fs.appendFile(f.mirror.receipt,'changed');if(mode==='missing-receipt')await fs.unlink(f.mirror.receipt);if(mode==='oversize-manifest')await fs.writeFile(f.mirror.manifest,'x'.repeat(16385));if(mode==='duplicate-json')await fs.writeFile(f.mirror.manifest,'{"scope":1,"scope":2}');
 await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow();
});
it.each(['manifest-file','manifest-directory','receipt-file'] as const)('rejects linked %s mirrors',async mode=>{
 const f=await mirroredFixture(),file=mode==='receipt-file'?f.mirror.receipt:f.mirror.manifest,target=file+'.actual';
 if(mode==='manifest-directory'){const directory=path.dirname(file);await fs.rename(directory,directory+'.actual');await fs.symlink(directory+'.actual',directory,process.platform==='win32'?'junction':'dir');}
 else{await fs.rename(file,target);await fs.symlink(target,file,'file');}
 await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow();
});
it('does not let a published mirror widen task scope or survive current-record revocation',async()=>{
 const f=await mirroredFixture();Object.assign(f.context,{findingIds:[]});await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow('task scope');
 Object.assign(f.context,{findingIds:['identity']});let count=0;f.context.guard.mockImplementation(()=>{if(++count===2)f.record.revision++;});await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow('record changed');
});
it.each(['unknown-finding','foreign-hash','record-sha','record-revision','foreign-repo','task-scope','ambiguous','arbitrary-path','traversal','oversize','tamper','binary','duplicate-json','invalid-json','missing'])('refuses %s receipt before publishing content',async mode=>{
 const f=await fixture(),ref=f.record.content.findings[0].evidence[0],request:any=structuredClone(f.request);
 if(mode==='unknown-finding')request.findingId='missing';if(mode==='foreign-hash')request.expectedSha256='b'.repeat(64);
 if(mode==='record-sha')request.reference.sha256='b'.repeat(64);if(mode==='record-revision')request.reference.revision=2;
 if(mode==='foreign-repo')f.context.repoId='foreign/repo';if(mode==='task-scope')Object.assign(f.context,{findingIds:['other']});
 if(mode==='ambiguous')f.record.content.findings[0].evidence.push({...ref});
 if(mode==='arbitrary-path')ref.reference=path.join(f.home,'msal-cache.json');if(mode==='traversal')request.file='../secret';
 if(mode==='oversize')await fs.writeFile(f.file,'x'.repeat(65537));if(mode==='tamper')await fs.appendFile(f.file,'changed');
 if(['binary','duplicate-json','invalid-json'].includes(mode)){const text=mode==='binary'?'\0':mode==='duplicate-json'?'{"scope":1,"scope":2}':'{broken';const hash=crypto.createHash('sha256').update(text).digest('hex');ref.sha256=request.expectedSha256=hash;ref.reference=path.join(path.dirname(f.file),hash+'.json');await fs.writeFile(ref.reference,text);}
 if(mode==='missing')await fs.unlink(f.file);
 await expect(readDeliveryEvidence(request,f.context)).rejects.toThrow();
});
it.each(['file','directory'])('rejects %s symlinks even when bytes and hash match',async mode=>{
 const f=await fixture();if(mode==='file'){const target=path.join(f.home,'outside.json');await fs.rename(f.file,target);await fs.symlink(target,f.file,'file');}
 else{const dir=path.dirname(f.file),outside=path.join(f.home,'outside');await fs.rename(dir,outside);await fs.symlink(outside,dir,process.platform==='win32'?'junction':'dir');}
 await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow('unavailable');
});
it('rechecks exact record and session after asynchronous IO',async()=>{
 const f=await fixture();let count=0;f.context.guard.mockImplementation(()=>{if(++count===2)f.record.revision++;});
 await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow('record changed');
 f.context.guard.mockImplementation(()=>{throw Error('session revoked');});await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow('session revoked');
});
it.each(['future-dated','within-recorded-window'])('reports %s without granting correctness or replay',async freshness=>{
 const f=await fixture(),ref=f.record.content.findings[0].evidence[0];ref.observedAt=new Date(Date.now()+(freshness==='future-dated'?120000:-1000)).toISOString();ref.expiresAt=new Date(Date.now()+180000).toISOString();const result=await readDeliveryEvidence(f.request,f.context);expect(result.freshness).toBe(freshness);expect(result).not.toHaveProperty('approved');expect(result.limits.join(' ')).toContain('No authoring, completeness, replay');
});
it('is wired through the existing approved source tool and the same enumerated synthesis roots',async()=>{
 const f=await fixture(),read=vi.fn();const result=await readDeliverySource(f.request,{repoId:f.record.repoId,sourceCommit:null,read,guard:f.context.guard,evidence:f.context});expect(result.content.length).toBe(6000);expect(read).not.toHaveBeenCalled();const captured=await captureSynthesisEvidence(f.record,discoveryEvidenceRoots(f.home));expect(captured[0].status).toBe('captured');expect(captured[0].text).toBe(f.text);
});
it('an explicitly empty admitted task finding scope never widens to whole-record evidence',async()=>{const f=await fixture();Object.assign(f.context,{findingIds:[]});await expect(readDeliveryEvidence(f.request,f.context)).rejects.toThrow('outside this task scope');});
it('keeps readable but over-model-budget receipt explicitly unavailable to synthesis',async()=>{const f=await fixture(JSON.stringify({scope:'read-only',data:'x'.repeat(40000)}));const result=await readDeliveryEvidence(f.request,f.context);expect(result.totalCharacters).toBe(f.text.length);const captured=await captureSynthesisEvidence(f.record,discoveryEvidenceRoots(f.home));expect(captured[0].status).toBe('unavailable');expect(captured[0].text).toBeUndefined();});
it('only explicit whole-record review and discovery/design tasks bypass an author filter',async()=>{const f=await fixture();f.record.content.tasks=[{issue:1,stage:'discovery'},{issue:2,stage:'design'},{issue:3,stage:'slice'}] as any;expect(deliveryEvidenceFindingIds(f.record,null,'qa')).toBeUndefined();expect(deliveryEvidenceFindingIds(f.record,1,'dev')).toBeUndefined();expect(deliveryEvidenceFindingIds(f.record,2,'dev')).toBeUndefined();expect(()=>deliveryEvidenceFindingIds(null,null,'qa')).toThrow();expect(()=>deliveryEvidenceFindingIds(f.record,99,'dev')).toThrow('admitted task scope');expect(()=>deliveryEvidenceFindingIds(f.record,3,'dev')).toThrow('admitted task scope');});
it('keeps a real empty author scope empty and includes critical/dependency findings only',async()=>{const f=await fixture(),content:any=f.record.content;Object.assign(content,{tasks:[{issue:3,stage:'slice',requirementIds:[]}],requirements:[],contracts:[],slice:{requirementIds:[]},taskPlan:{tasks:[{issue:3,dependsOn:[],componentIds:[],checkIds:[]}]},applicationSpec:{components:[],assumptions:[],securityBoundaries:[],journeys:[],decisions:[],checks:[]}});expect(deliveryEvidenceFindingIds(f.record,3,'dev')).toEqual([]);content.findings[0].critical=true;expect(deliveryEvidenceFindingIds(f.record,3,'dev')).toEqual(['identity']);});
it.each(['file','root'])('synthesis never captures linked %s receipts even with matching hashes',async mode=>{const f=await fixture();if(mode==='file'){const target=path.join(f.home,'actual.json');await fs.rename(f.file,target);await fs.symlink(target,f.file,'file');}else{const root=path.dirname(f.file),target=path.join(f.home,'actual-store');await fs.rename(root,target);await fs.symlink(target,root,process.platform==='win32'?'junction':'dir');}const captured=await captureSynthesisEvidence(f.record,discoveryEvidenceRoots(f.home));expect(captured[0].status).toBe('unavailable');expect(captured[0].text).toBeUndefined();});
it('synthesis publication rejects a receipt replaced with a same-byte link after capture',async()=>{const f=await fixture(),captured=await captureSynthesisEvidence(f.record,discoveryEvidenceRoots(f.home)),target=path.join(f.home,'actual.json');expect(captured[0].status).toBe('captured');await fs.rename(f.file,target);await fs.symlink(target,f.file,'file');await expect(verifySynthesisEvidence(captured)).rejects.toThrow('changed');});
it.each([null,undefined])('unassigned development (%s) never inherits whole-record QA authority',async issue=>{const f=await fixture();expect(()=>deliveryEvidenceFindingIds(f.record,issue,'dev')).toThrow();expect(deliveryEvidenceFindingIds(f.record,issue,'qa')).toBeUndefined();});
