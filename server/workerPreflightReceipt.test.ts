import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {retainWorkerPreflightReceipt} from './workerPreflightReceipt.ts';
import type {WorkerPreflight} from './workerPreflight.ts';
import {readDeliveryEvidence} from './deliveryEvidenceRead.ts';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {readWorkerCanvasSnapshot} from './workerCanvasSnapshot.ts';
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const context={repoId:'test/repo',agentId:'qa',runtime:'codex',attemptId:'attempt',taskKey:'test/repo:dev:1',sourceRevision:'a'.repeat(40)};
const status=()=>({schemaVersion:1,scope:'worker-session-preflight',mode:'discovery',contractSha256:'b'.repeat(64),configurationError:null,skills:[],probes:[{id:'native',tool:'mcp__native__inspect',matched:true,observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),proof:{callId:'probe',resultSha256:'c'.repeat(64),adapter:'native-json-object-v1'},assertions:[]}],sourceCaptureDirectory:null,sourceCapture:null,nativeChecksSatisfied:true,authoringAuthorityGranted:false}) as ReturnType<WorkerPreflight['inspection']>;
function root(){const result=fs.mkdtempSync(path.join(os.tmpdir(),'worker-receipt-'));roots.push(result);return result;}
it('persists and pages a complete authored-screen capture below the existing64KiB receipt limit',async()=>{
 const home=root(),directory=root(),content='Screen1:\n  Text: '+ 'x'.repeat(40*1024);fs.writeFileSync(path.join(directory,'App.pa.yaml'),'App: {}');fs.writeFileSync(path.join(directory,'Screen1.pa.yaml'),content);
 const prior=await retainWorkerPreflightReceipt(home,context,status(),async()=>{}),priorBytes=fs.readFileSync(prior.evidence.reference),current=status();current.sourceCaptureDirectory=directory;current.sourceCapture={...readWorkerCanvasSnapshot(directory,2),callId:'sync',resultSha256:'e'.repeat(64),contractSha256:current.contractSha256!,observedAt:new Date().toISOString(),adapter:'canvas-native-source-sync-v1'};
 const retained=await retainWorkerPreflightReceipt(home,{...context,attemptId:'large'},current,async()=>{});expect(fs.statSync(retained.evidence.reference).size).toBeLessThan(65536);
 const record={id:crypto.randomUUID(),repoId:context.repoId,revision:1,sha256:'d'.repeat(64),content:{findings:[{id:'preflight',evidence:[retained.evidence]}]}} as unknown as DeliveryRecord;
 let text='',startCharacter=0;while(true){const page=await readDeliveryEvidence({kind:'discovery-evidence',reference:recordReference(record),findingId:'preflight',expectedSha256:retained.evidence.sha256,startCharacter,maxCharacters:6000},{home,repoId:context.repoId,record:()=>record,guard:()=>{}});text+=page.content;if(page.nextCharacter===null)break;startCharacter=page.nextCharacter;}
 expect(JSON.parse(text).preflight.sourceCapture.files.find((f:{file:string})=>f.file==='Screen1.pa.yaml').content).toBe(content);expect(JSON.parse(text).preflight.authoringAuthorityGranted).toBe(false);expect(fs.readFileSync(prior.evidence.reference)).toEqual(priorBytes);
});
it('retains hash-addressed task and attempt evidence without deleting earlier receipts',async()=>{
 const home=root(),guard=vi.fn(async()=>{}),first=await retainWorkerPreflightReceipt(home,context,status(),guard),bytes=fs.readFileSync(first.evidence.reference);
 expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(first.evidence.sha256);expect(first.observation).toMatchObject({...context,preflight:{authoringAuthorityGranted:false}});expect(guard).toHaveBeenCalledTimes(3);
 await retainWorkerPreflightReceipt(home,{...context,attemptId:'next-attempt'},status(),guard);expect(fs.readFileSync(first.evidence.reference).equals(bytes)).toBe(true);
});
it('can be inspected through the exact record-cited QA evidence reader',async()=>{
 const home=root(),retained=await retainWorkerPreflightReceipt(home,context,status(),async()=>{});
 const record={id:crypto.randomUUID(),repoId:context.repoId,revision:1,sha256:'d'.repeat(64),content:{findings:[{id:'preflight',evidence:[retained.evidence]}]}} as unknown as DeliveryRecord;
 const page=await readDeliveryEvidence({kind:'discovery-evidence',reference:recordReference(record),findingId:'preflight',expectedSha256:retained.evidence.sha256},{home,repoId:context.repoId,record:()=>record,guard:()=>{}});
 expect(JSON.parse(page.content)).toMatchObject({...context,preflight:{nativeChecksSatisfied:true,authoringAuthorityGranted:false}});expect(page.freshness).toBe('within-recorded-window');
});
it('does not overwrite conflicting bytes at an existing receipt path',async()=>{
 const home=root(),open=fs.openSync;let preserved='';vi.spyOn(fs,'openSync').mockImplementation(((file,flags,...rest)=>{if(flags==='wx'){preserved=String(file);fs.writeFileSync(file,'prior evidence');const error=new Error('exists') as NodeJS.ErrnoException;error.code='EEXIST';throw error;}return open(file,flags,...rest);}) as typeof fs.openSync);
 await expect(retainWorkerPreflightReceipt(home,context,status(),async()=>{})).rejects.toThrow('collision');expect(fs.readFileSync(preserved,'utf8')).toBe('prior evidence');
});
it('retains evidence but withholds success if ownership is revoked after persistence',async()=>{
 const home=root();let calls=0;await expect(retainWorkerPreflightReceipt(home,context,status(),async()=>{if(++calls===3)throw Error('Revoked');})).rejects.toThrow('Revoked');
 expect(fs.readdirSync(path.join(home,'planning','evidence'))).toHaveLength(1);
});
it('refuses expired successful checks and invalid task binding before writing',async()=>{
 const home=root(),expired=status();expired.probes[0].expiresAt=new Date(0).toISOString();await expect(retainWorkerPreflightReceipt(home,context,expired,async()=>{})).rejects.toThrow('Expired');
 await expect(retainWorkerPreflightReceipt(home,{...context,taskKey:'other/repo:dev:1'},status(),async()=>{})).rejects.toThrow('binding');expect(fs.existsSync(path.join(home,'planning'))).toBe(false);
});
it('refuses redirected evidence stores without writing through them',async()=>{
 const home=root(),outside=root();fs.mkdirSync(path.join(home,'planning'));fs.symlinkSync(outside,path.join(home,'planning','evidence'),'junction');
 await expect(retainWorkerPreflightReceipt(home,context,status(),async()=>{})).rejects.toThrow('Unsafe');expect(fs.readdirSync(outside)).toEqual([]);
});
it('rejects a redirected parent before creating the evidence directory',async()=>{
 const home=root(),outside=root();fs.symlinkSync(outside,path.join(home,'planning'),'junction');
 await expect(retainWorkerPreflightReceipt(home,context,status(),async()=>{})).rejects.toThrow('Unsafe');expect(fs.readdirSync(outside)).toEqual([]);
});
it('revalidates the parent after an asynchronous authority guard',async()=>{
 const home=root(),outside=root();fs.mkdirSync(path.join(home,'planning'));let calls=0;
 await expect(retainWorkerPreflightReceipt(home,context,status(),async()=>{if(++calls===2){fs.renameSync(path.join(home,'planning'),path.join(home,'preserved-planning'));fs.symlinkSync(outside,path.join(home,'planning'),'junction');}})).rejects.toThrow('Unsafe');expect(fs.readdirSync(outside)).toEqual([]);
});
