import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterEach,expect,it} from 'vitest';
import {ZipFile} from 'yazl';
import {writePinnedSource} from './testFixtures/pinnedArtifact.ts';
import {readPinnedBlob,collectPinnedPreparation,verifyEmptySolution,materializePinnedPreparation,verifyLocalPreparation,digest} from './pinnedPreparation.ts';
import {nativeEnvironment,pinnedGitArgs,isPinnedGitArgs} from './pinnedPreparationContracts.ts';
import {journalPinnedPreparation,inspectNativeCommands} from './nativeCommandJournal.ts';
import {acquireDeliveryLease} from './deliveryLease.ts';
import {DeliveryService,deliveryManifest,type DeliveryDependencies} from './delivery.ts';
import {manifestDigest} from './lifecycleGovernance.ts';
import type {RepoView} from '../shared/types.ts';
const roots:string[]=[],services:DeliveryService[]=[];afterEach(async()=>{for(const service of services.splice(0))await service.close();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const id='11111111-1111-4111-8111-111111111111',target={environmentUrl:'https://synthetic.crm4.dynamics.com',binding:{organizationId:id,userId:id},identity:{tenantId:id,username:'tester@example.test',environmentId:id}};
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-primary-'));roots.push(root);const source=path.join(root,'source'),data=await writePinnedSource(source,'synthetic/repo',target);const read=(file:string)=>readPinnedBlob(async args=>(await promisify(execFile)('git',args,{cwd:source,env:nativeEnvironment(process.env,args,'git'),windowsHide:true})).stdout,data.head,file);return {root,source,...data,read};}
// Real Git fixtures need process-startup time; the lease case also uses a 15s native mutex deadline. Pure in-memory tests retain the default budget.
it('journals closed local preparation, certifies current artifacts and refuses tampering',async()=>{const f=await fixture(),lease=await acquireDeliveryLease(f.root);try{const bytes=await fs.readFile(path.join(f.root,'delivery.lock'));const value=await collectPinnedPreparation(f.plan.preparation,await f.read('cubefarm.delivery.json'),f.manifest,path.join(f.root,'checkout'),f.read);const inventory=await journalPinnedPreparation(f.root,lease.identitySha256,'run',value.plan,value.buffers,()=>lease.assertOwned());expect(inventory.archiveComplete).toBe(true);expect((await inspectNativeCommands(f.root,bytes)).nativeTreeQuiescenceVerified).toBe(true);expect(await verifyEmptySolution(path.join(value.plan.checkout,'probe.zip'),'CubeFarmResumeProbe')).toMatchObject({restorationVerified:false,tenantMetadataMutation:true});await fs.appendFile(path.join(value.plan.checkout,'README-probe.md'),'changed');await expect(inspectNativeCommands(f.root,bytes)).rejects.toThrow('changed');}finally{await lease.release();}},30000);
it.each(['manifest','package','missing-doc','collision'])('rejects pinned %s drift',async mode=>{const f=await fixture();if(mode==='manifest')f.plan.preparation.manifestSha256='0'.repeat(64);if(mode==='package')f.manifest.preparation.packageSha256='0'.repeat(64);if(mode==='missing-doc')f.manifest.preparation.files.pop();if(mode==='collision')f.manifest.preparation.files[0].path='cubefarm.delivery.json';await expect(collectPinnedPreparation(f.plan.preparation,JSON.stringify(f.manifest),f.manifest,path.join(f.root,'checkout'),f.read)).rejects.toThrow();},15000);
it('requires explicit typed opt-in and forbids scripts/UI in the empty-package exclusion',async()=>{const f=await fixture();expect(deliveryManifest.safeParse(f.manifest).success).toBe(true);for(const patch of [{preparation:undefined},{build:[{executable:'node',args:['build.js']}]},{hasUi:true},{postDeployActions:[{id:'arbitrary'}]}])expect(deliveryManifest.safeParse({...f.manifest,...patch}).success).toBe(false);},15000);
it('runs normal release APIs and persists a job before injected provider interruption, without fetch/worktree/custom scripts',async()=>{
 const f=await fixture(),calls:string[][]=[],deps:DeliveryDependencies={governance:async request=>({status:'clear',phase:request.phase,sourceCommit:request.sourceCommit,releaseId:request.releaseId,environmentUrl:request.environmentUrl,manifestSha256:manifestDigest(request.manifest),checkedAt:new Date().toISOString(),artifactSha256:f.packageSha256,policySha256:'a'.repeat(64),schemaSha256:'b'.repeat(64),reasons:['Synthetic isolated acceptance provider; no live assurance']}),run:async(command,cwd)=>{calls.push([command.executable,...command.args]);if(command.executable==='git')return(await promisify(execFile)('git',command.args,{cwd,env:nativeEnvironment(process.env,command.args,'git'),windowsHide:true})).stdout;if(command.executable==='gh')return '{"state":"CLOSED"}';if(command.executable==='pac')return command.args[0]==='org'?`Org ID: ${id}\nUser ID: ${id}\nOrg URL: ${target.environmentUrl}\nEnvironment ID: ${id}\nUser Email: tester@example.test`:'[]';if(command.args[0]==='auth')return `Tenant: ${id}\nUser: tester@example.test\nEnvironment: ${target.environmentUrl}`;if(command.args.includes('POST')){const saved=JSON.parse(await fs.readFile(path.join(f.root,'delivery.json'),'utf8')),body=JSON.parse(await fs.readFile(command.args.at(-1)!,'utf8'));expect(saved.runs[0].operations[0].platformJobId).toBe(body.ImportJobId);throw new Error('Synthetic in-flight interruption');}return command.args.at(-1)?.includes('RetrieveCurrentOrganization')?JSON.stringify({Detail:{OrganizationId:id,TenantId:id,EnvironmentId:id,State:'Enabled'}}):JSON.stringify({OrganizationId:id,UserId:id});}};
 const service=new DeliveryService(f.root,false,deps);services.push(service);await service.init();await service.configure(target.environmentUrl,true);service.checkCapabilities=async()=>({status:'ready',checks:[{id:'provider-authentication',category:'authentication',passed:true,remedy:''},{id:'target-environment',category:'environment',passed:true,remedy:''}]});
 const repo={id:'synthetic/repo',fullName:'synthetic/repo',checkoutPath:f.source,defaultBranch:'main',cloneStatus:'ready'} as RepoView;const release=await service.createRelease(repo,f.plan);await service.reviewArchitecture(release.id,'qa-pinned',release.planHash,f.architectureReview);await service.approveRelease(release.id,'qa-pinned',release.planHash);await service.start(repo,false,release.id);await service.waitForIdle();const run=service.view().runs[0];expect(run.error).toContain('Synthetic in-flight interruption');expect(run.operations?.[0].platformJobId).toMatch(/^[a-f0-9-]{36}$/);expect(calls.some(call=>call[0]==='git'&&['fetch','worktree','diff'].includes(call[1]))).toBe(false);expect(calls.some(call=>['node','npm','powershell'].includes(call[0]))).toBe(false);
},30000);

async function emptyCandidate(root:string,patch:Record<string,string>={}){
 const entries={'solution.xml':'<ImportExportXml><SolutionManifest><UniqueName>CubeFarmResumeProbe</UniqueName><Managed>0</Managed><RootComponents /><MissingDependencies /></SolutionManifest></ImportExportXml>','customizations.xml':'<ImportExportXml><Entities /></ImportExportXml>','[Content_Types].xml':'<Types />',...patch},zip=new ZipFile(),chunks:Buffer[]=[];
 for(const [name,text] of Object.entries(entries))zip.addBuffer(Buffer.from(text),name);
 zip.outputStream.on('data',chunk=>chunks.push(chunk));zip.end();await new Promise(resolve=>zip.outputStream.on('end',resolve));const file=path.join(root,'negative.zip');await fs.writeFile(file,Buffer.concat(chunks));return file;
}
it.each(['component','managed','name','customization','extra','entity'])('does not waive recovery for an empty-looking %s package',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-empty-negative-'));roots.push(root);let manifest='<ImportExportXml><SolutionManifest><UniqueName>CubeFarmResumeProbe</UniqueName><Managed>0</Managed><RootComponents /><MissingDependencies /></SolutionManifest></ImportExportXml>';
 if(mode==='component')manifest=manifest.replace('<RootComponents />','<RootComponents><RootComponent type="1" /></RootComponents>');
 if(mode==='managed')manifest=manifest.replace('<Managed>0','<Managed>1');
 if(mode==='name')manifest=manifest.replace('CubeFarmResumeProbe','OtherSolution');
 const patch:Record<string,string>={'solution.xml':manifest};
 if(mode==='customization')patch['customizations.xml']='<ImportExportXml><Entities><Entity Name="exp_real" /></Entities></ImportExportXml>';
 if(mode==='extra')patch['payload.txt']='arbitrary';
 if(mode==='entity')patch['customizations.xml']='<!DOCTYPE ImportExportXml [<!ENTITY x "value">]><ImportExportXml><Entities /></ImportExportXml>';
 await expect(verifyEmptySolution(await emptyCandidate(root,patch),'CubeFarmResumeProbe')).rejects.toThrow();
});
it('rejects executable, aliased and oversized source blob responses before use',async()=>{
 const head='a'.repeat(40);for(const entry of [`100755 blob ${head}\tdoc.md\0`,`100644 blob ${head}\tother.md\0`,`100644 blob ${head}\tdoc.md\0extra`])await expect(readPinnedBlob(async()=>entry,head,'doc.md')).rejects.toThrow('exact regular');
 await expect(readPinnedBlob(async args=>args.includes('ls-tree')?`100644 blob ${head}\tdoc.md\0`:'x'.repeat(8*1024*1024+1),head,'doc.md')).rejects.toThrow('bound');
});

it('admits only the exact isolated Git grammar and preserves unrelated command environments',()=>{
 const head='a'.repeat(40),blob=pinnedGitArgs('blob',head,'doc.md'),entry=pinnedGitArgs('entry',head,'doc.md');expect(isPinnedGitArgs(blob)).toBe(true);expect(isPinnedGitArgs(entry)).toBe(true);
 for(const args of [blob.slice(1),[...blob,'--filters'],[...entry.slice(0,-2),'-r','doc.md'],[...blob.slice(0,-1),head+':../escape'],[...entry.slice(0,-3),'invalid','--','doc.md']])expect(isPinnedGitArgs(args)).toBe(false);
 expect(nativeEnvironment({GIT_DIR:'preserve',PATH:'unchanged'},['status'],'git')).toEqual({GIT_DIR:'preserve',PATH:'unchanged'});expect(nativeEnvironment({GIT_DIR:'preserve'},blob,'other.exe')).toEqual({GIT_DIR:'preserve'});
});
it.each(['noncanonical','oversized','missing-file','unsafe-package-path'])('rejects invalid pinned transport %s',async mode=>{
 const f=await fixture();const manifestText=await f.read('cubefarm.delivery.json');let read=f.read;
 if(mode==='noncanonical')read=async file=>file===f.manifest.preparation.packageBase64?(await f.read(file))+'\n':f.read(file);
 if(mode==='oversized')read=async file=>file===f.manifest.preparation.packageBase64?'A'.repeat(8*1024*1024+1):f.read(file);
 if(mode==='missing-file')f.manifest.documentation.push('missing.md');
 if(mode==='unsafe-package-path')f.manifest.solutionZip='../escape';
 await expect(collectPinnedPreparation(f.plan.preparation,manifestText,f.manifest,path.join(f.root,'checkout'),read)).rejects.toThrow();
},15000);

it.each(['file-hash','package-source-alias','package-target-alias','rehearsal'])('requires complete nonaliased approved sources: %s',async mode=>{
 const f=await fixture(),text=await f.read('cubefarm.delivery.json');
 if(mode==='file-hash')f.manifest.preparation.files[0].sha256='f'.repeat(64);
 if(mode==='package-source-alias')f.manifest.preparation.packageBase64=f.manifest.preparation.files[0].path;
 if(mode==='package-target-alias')f.manifest.preparation.packageBase64=f.manifest.solutionZip;
 if(mode==='rehearsal')(f.manifest.recovery as {rehearsalReport?:string}).rehearsalReport='missing-rehearsal.json';
 await expect(collectPinnedPreparation(f.plan.preparation,text,f.manifest,path.join(f.root,'checkout'),f.read)).rejects.toThrow();
},15000);
it('materializes and rechecks nested reviewed documents without following filesystem objects',async()=>{
 const f=await fixture(),value=await collectPinnedPreparation(f.plan.preparation,await f.read('cubefarm.delivery.json'),f.manifest,path.join(f.root,'checkout'),f.read);
 const bytes=Buffer.from('nested reviewed');value.buffers.set('docs/one.md',bytes);value.buffers.set('docs/two.md',bytes);value.plan.files.push(...['docs/one.md','docs/two.md'].map(file=>({path:file,sha256:digest(bytes)})));
 await materializePinnedPreparation(value.plan,value.buffers);await verifyLocalPreparation(value.plan);
 await fs.unlink(path.join(value.plan.checkout,'docs/one.md'));await fs.unlink(path.join(value.plan.checkout,'docs/two.md'));await fs.rmdir(path.join(value.plan.checkout,'docs'));await fs.writeFile(path.join(value.plan.checkout,'docs'),'not a directory');
 await expect(verifyLocalPreparation(value.plan)).rejects.toThrow('Unsafe preparation parent');
 await expect(verifyLocalPreparation({...value.plan,checkout:'relative'})).rejects.toThrow('real private');
},15000);
it.each(['missing','changed','bad-zip'])('does not certify failed local preparation %s',async mode=>{
 const f=await fixture(),value=await collectPinnedPreparation(f.plan.preparation,await f.read('cubefarm.delivery.json'),f.manifest,path.join(f.root,'checkout'),f.read),file=value.plan.files[1];
 if(mode==='missing')value.buffers.delete(file.path);if(mode==='changed')value.buffers.set(file.path,Buffer.from('unapproved'));
 if(mode==='bad-zip'){const bytes=Buffer.from('not a zip');value.buffers.set(f.manifest.solutionZip,bytes);value.plan.files.find(file=>file.path===f.manifest.solutionZip)!.sha256=digest(bytes);}
 await expect(materializePinnedPreparation(value.plan,value.buffers)).rejects.toThrow();
},15000);
it('rejects a directory masquerading as an empty solution package',async()=>{const f=await fixture();await expect(verifyEmptySolution(f.root,'CubeFarmResumeProbe')).rejects.toThrow('regular');},15000);
