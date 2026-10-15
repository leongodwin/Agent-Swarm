import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {ZipFile} from 'yazl';
import {afterEach,it,expect} from 'vitest';
import {createDeliveryGovernance} from './deliveryGovernance.ts';import {ManualGovernance,manualControls} from './manualGovernance.ts';
import {manifestDigest,requireLifecycleGovernance,type LifecycleRequest} from './lifecycleGovernance.ts';import type {DeclaredSchemaObservation} from './declaredSchema.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const id='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64);
async function fixture(payload=''){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manual-delivery-'));roots.push(root);const file=path.join(root,'package.zip');
 const zip=new ZipFile();zip.addBuffer(Buffer.from('<ImportExportXml><SolutionManifest><UniqueName>ExpensePilot</UniqueName><Version>1.0.0.0</Version><Managed>0</Managed><RootComponents><RootComponent type="1" schemaName="exp_report" behavior="2" /></RootComponents></SolutionManifest></ImportExportXml>'),'solution.xml');zip.addBuffer(Buffer.from(`<ImportExportXml><Entities><Entity><Name>exp_report</Name><EntityInfo><entity Name="exp_report" unmodified="1"><attributes /></entity></EntityInfo>${payload}</Entity></Entities></ImportExportXml>`),'customizations.xml');zip.addBuffer(Buffer.from('<Types />'),'[Content_Types].xml');const chunks:Buffer[]=[];zip.outputStream.on('data',chunk=>chunks.push(chunk));zip.end();await new Promise(resolve=>zip.outputStream.on('end',resolve));await fs.writeFile(file,Buffer.concat(chunks));
 const manifest={schemaVersion:1,solutionUniqueName:'ExpensePilot',solutionVersion:'1.0.0.0',solutionZip:'package.zip',hasUi:false,manualDevelopmentGovernance:true,recovery:{runbook:'recovery.md',scope:'pilot-owned-development-records'},documentation:['one.md','two.md','three.md'],build:[{executable:'node',args:['build.js']}],test:[{executable:'node',args:['test.js']}],verify:[{executable:'node',args:['verify.js']}],targetBinding:{organizationId:id,userId:id},platformIdentity:{tenantId:id,username:'test@synthetic.test',environmentId:id},targetComponents:[{key:'report',kind:'dataverse-table',logicalName:'exp_report'}],postDeployActions:[{id:'schema',type:'schema-check',component:'report',columns:[{name:'exp_name',type:'String',required:'None'}]}]};
 const request:LifecycleRequest={phase:'build',sourceCommit:'b'.repeat(40),releaseId:'release',environmentUrl:'https://test.crm4.dynamics.com',checkout:root,manifest,acceptanceProfile:'functional-development',packageSha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),evidenceDirectory:root};
 const implementation={sha256:hash,evidence:[{file,sha256:request.packageSha256!}]};
 const manual=new ManualGovernance(root,()=>({repoId:'test/repo',head:request.sourceCommit,environmentUrl:request.environmentUrl,planHash:hash,plan:{owner:'dev',qaOwner:'qa',acceptanceProfile:'functional-development'}}),()=>{},implementation);await manual.init();
 const observe=async(input:LifecycleRequest):Promise<DeclaredSchemaObservation>=>({scope:'declared-target-schema',complete:false,status:'observed',phase:input.phase,sourceCommit:input.sourceCommit,releaseId:input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:manifestDigest(input.manifest),identity:manifest.platformIdentity,binding:manifest.targetBinding,checkedAt:new Date().toISOString(),reason:'Synthetic target contract observation only',tables:['exp_report'],observations:[{resource:'EntityDefinitions',value:{synthetic:true}}]});
 const provider=createDeliveryGovernance({observation:()=>({schemaVersion:1,tenantId:id,caller:'test@synthetic.test',observedAt:new Date().toISOString(),source:'Get-DlpPolicy module route',moduleVersion:'2.0.219',scope:'standard-policy-inventory',complete:true,pages:1,policies:[]})},observe,undefined,undefined,manual);
 return {root,request,manual,provider};
}
it('authorises only independently reviewed reference-only development facts, retains the assessment and blocks drift/production',async()=>{
 const f=await fixture();expect((await f.provider(f.request)).status).toBe('unavailable');const row=f.manual.view('test/repo')[0];expect(row).toBeDefined();
 await f.manual.review('test/repo',row.id,'qa',{decision:'approved',controls:[...manualControls],notes:'Independent synthetic review of reference-only package, policy non-applicability, target contracts, existing licences and protected-data recovery.'});
 const result=await f.provider(f.request);expect(result).toMatchObject({status:'clear',assurance:'manual-functional-development',manualAssessmentId:row.id});expect(JSON.parse(await fs.readFile(path.join(f.root,result.manualAssessmentFile!),'utf8')).review.decision).toBe('approved');
 await requireLifecycleGovernance(f.provider,f.request,f.root,1);
 expect((await f.provider({...f.request,acceptanceProfile:'production'})).status).not.toBe('clear');
 expect((await f.provider({...f.request,phase:'import'})).status).not.toBe('clear');
 expect((await f.provider({...f.request,packageSha256:'c'.repeat(64)})).status).not.toBe('clear');
});
it('does not admit embedded ribbon/executable payloads through table references',async()=>{
 const f=await fixture('<RibbonDiffXml><CustomActions><CustomAction Id="unexpected"><JavaScriptFunction FunctionName="execute" /></CustomAction></CustomActions></RibbonDiffXml>');
 expect((await f.provider(f.request)).status).not.toBe('clear');expect(f.manual.view('test/repo')).toEqual([]);
});
