import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {verifyCanvasSourceSync} from './canvasSourceSync.ts';

it('withholds a successful source-sync observation when authority is cancelled during acknowledged cleanup',async()=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canvas-independent-'));
 const controller=new AbortController();
 const environmentId='Default-11111111-1111-4111-8111-111111111111',appId='22222222-2222-4222-8222-222222222222',account='maker@example.test';
 try{
  const result=await verifyCanvasSourceSync({environmentId,appId,account,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit&app-id=${appId}`},root,controller.signal,async()=>({
   async call(tool,args){
    if(tool==='connect')return `Successfully connected for app: ${appId}, environment ${environmentId}. Signed in as: ${account}.`;
    if(tool==='list_accounts')return `- ${account} (connected)`;
    if(tool==='sync_canvas'){await fs.writeFile(path.join(String(args.directoryPath),'App.pa.yaml'),'App: {}');await fs.writeFile(path.join(String(args.directoryPath),'Screen1.pa.yaml'),'Screens: {}');return 'Synced';}
    throw new Error('Unapproved operation');
   },
   async close(){controller.abort(new Error('Authority revoked during cleanup'));}
  }));
  expect(result.cleanupVerified).toBe(true);
  expect(result.status).toBe('blocked');
  expect(result.sourceSyncObserved).toBe(false);
  expect(result.authoringApproved).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});

it.each(['source-mutation','directory-replacement'])('rejects %s during cleanup despite a successful native pull',async mode=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canvas-independent-'));
 const environmentId='Default-11111111-1111-4111-8111-111111111111',appId='22222222-2222-4222-8222-222222222222',account='maker@example.test';
 let directory='';
 try{
  const result=await verifyCanvasSourceSync({environmentId,appId,account,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit&app-id=${appId}`},root,new AbortController().signal,async()=>({
   async call(tool,args){
    if(tool==='connect')return `Successfully connected for app: ${appId}, environment ${environmentId}. Signed in as: ${account}.`;
    if(tool==='list_accounts')return `- ${account} (connected)`;
    directory=String(args.directoryPath);await fs.writeFile(path.join(directory,'App.pa.yaml'),'App: {}');await fs.writeFile(path.join(directory,'Screen1.pa.yaml'),'Screens: {}');return 'Synced';
   },
   async close(){
    if(mode==='source-mutation')await fs.writeFile(path.join(directory,'Screen1.pa.yaml'),'Screens: {changed: true}');
    else{await fs.rename(directory,`${directory}-original`);await fs.mkdir(directory);await fs.writeFile(path.join(directory,'App.pa.yaml'),'App: {}');await fs.writeFile(path.join(directory,'Screen1.pa.yaml'),'Screens: {}');}
   }
  }));
  expect(result.cleanupVerified).toBe(true);expect(result.status).toBe('blocked');expect(result.sourceSyncObserved).toBe(false);expect(result.stage).toBe('post-cleanup-source-recheck');
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});

it('the CLI refuses an unsaved target before spawning the supplied native executable',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canvas-cli-independent-'));
 const marker=path.join(root,'unexpected-spawn.txt'),server=path.join(root,'native-sentinel.cmd');
 try{
  await fs.writeFile(server,`@echo off\r\necho spawned>"${marker}"\r\n`);
  const error=await promisify(execFile)(process.execPath,['--import','tsx','scripts/verify-canvas-source-sync.ts','--live','--studio-url','https://make.powerapps.com/','--environment-id','Default-11111111-1111-4111-8111-111111111111','--app-id','22222222-2222-4222-8222-222222222222','--account','maker@example.test','--server',server,'--output-root',root],{cwd:process.cwd(),timeout:10000}).then(()=>null,e=>e);
  expect(error?.code).toBe(2);expect(JSON.parse(error.stdout).stage).toBe('saved-app-target-or-output-validation');expect(await fs.readdir(root)).toEqual(['native-sentinel.cmd']);
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
},15000);

it.each(['wrong-app','wrong-environment','wrong-account','legacy-account-only'])('rejects %s native connection before account discovery or sync',async mode=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canvas-binding-independent-'));
 const environmentId='Default-11111111-1111-4111-8111-111111111111',appId='22222222-2222-4222-8222-222222222222',account='maker@example.test',calls:string[]=[];let closed=false;
 try{
  const result=await verifyCanvasSourceSync({environmentId,appId,account,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit&app-id=${appId}&template-name=HeaderMainFooter`},root,new AbortController().signal,async()=>({
   async call(tool){calls.push(tool);if(mode==='legacy-account-only')return `Connected as ${account}`;return `Successfully connected for app: ${mode==='wrong-app'?'33333333-3333-4333-8333-333333333333':appId}, environment ${mode==='wrong-environment'?'Default-33333333-3333-4333-8333-333333333333':environmentId}. Signed in as: ${mode==='wrong-account'?'other@example.test':account}.`;},async close(){closed=true;}
  }));
  expect(result.sourceSyncObserved).toBe(false);expect(result.status).toBe('blocked');expect(calls).toEqual(['connect']);expect(closed).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});

it('accepts the genuine saved template edit URL but refuses template creation without a saved app',async()=>{
 const {savedCanvasTarget}=await import('./canvasSourceSync.ts');
 const environmentId='Default-11111111-1111-4111-8111-111111111111',appId='22222222-2222-4222-8222-222222222222',account='maker@example.test';
 const target={environmentId,appId,account,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit&app-id=${appId}&template-name=HeaderMainFooter`};
 expect(savedCanvasTarget(target).appId).toBe(appId);
 expect(()=>savedCanvasTarget({...target,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=app-from-screen-template&template-name=HeaderMainFooter`})).toThrow();
 expect(()=>savedCanvasTarget({...target,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit&template-name=HeaderMainFooter`})).toThrow();
 expect(()=>savedCanvasTarget({...target,studioUrl:target.studioUrl+'&template-name=Other'})).toThrow();
});

it.each(['leaf-recreate','outer-replace'])('handles native %s without granting capture-container replacement',async mode=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canvas-leaf-independent-'));
 const environmentId='Default-11111111-1111-4111-8111-111111111111',appId='22222222-2222-4222-8222-222222222222',account='maker@example.test';let closed=false;
 try{
  const result=await verifyCanvasSourceSync({environmentId,appId,account,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit&app-id=${appId}`},root,new AbortController().signal,async()=>({
   async call(tool,args){
    if(tool==='connect')return `Successfully connected for app: ${appId}, environment ${environmentId}. Signed in as: ${account}.`;
    if(tool==='list_accounts')return `- ${account} (connected)`;
    const leaf=String(args.directoryPath),outer=path.dirname(leaf);expect(await fs.readdir(leaf)).toEqual([]);
    if(mode==='leaf-recreate'){await fs.rmdir(leaf);await fs.mkdir(leaf);}
    else{await fs.rename(outer,`${outer}-original`);await fs.mkdir(outer);await fs.mkdir(leaf);}
    await fs.writeFile(path.join(leaf,'App.pa.yaml'),'App: {}');await fs.writeFile(path.join(leaf,'Screen1.pa.yaml'),'Screens: {}');return 'Synced';
   },async close(){closed=true;}
  }));
  expect(closed).toBe(true);expect(result.cleanupVerified).toBe(true);expect(result.sourceSyncObserved).toBe(mode==='leaf-recreate');expect(result.status).toBe(mode==='leaf-recreate'?'source-sync-observed':'blocked');
  if(mode==='outer-replace')expect(result.failureCode).toBe('capture-directory-changed');
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
