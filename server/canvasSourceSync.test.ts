import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {savedCanvasTarget,verifyCanvasSourceSync,type CanvasSyncClient} from './canvasSourceSync.ts';

const environmentId='Default-11111111-1111-4111-8111-111111111111',appId='22222222-2222-4222-8222-222222222222',account='maker@example.test';
const input={environmentId,appId,account,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F${appId}`};
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
const text=(value:string)=>({content:[{type:'text',text:value}]});
async function fixture(){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'canvas-sync-test-'));roots.push(root);
 const existing=path.join(root,'existing-source');await fs.mkdir(existing);await fs.writeFile(path.join(existing,'App.pa.yaml'),'preserved prior work');
 let workspace='';
 const call=vi.fn(async(tool:string,args:Record<string,unknown>)=>{
  if(tool==='connect')return text(`Successfully connected for app: ${appId}, environment ${environmentId}. Signed in as: ${account}.`);
  if(tool==='list_accounts')return text(`Signed-in accounts:\n- ${account} (connected)`);
  if(tool==='sync_canvas'){workspace=String(args.directoryPath);await fs.writeFile(path.join(workspace,'App.pa.yaml'),'App:\n  Properties:\n    StartScreen: =Screen1\n');await fs.writeFile(path.join(workspace,'Screen1.pa.yaml'),'Screens:\n  Screen1:\n    Children: []\n');return text('Synced source files');}
  throw new Error('Unexpected tool');
 });
 const close=vi.fn(async()=>{}),client={call,close},connect=vi.fn(async()=>client as CanvasSyncClient),controller=new AbortController();
 return {root,existing,call,close,connect,controller,get workspace(){return workspace;},run:()=>verifyCanvasSourceSync(input,root,controller.signal,connect)};
}
it.each([
 {...input,appId:undefined},
 {...input,environmentId:'------------------------------------'},
 {...input,studioUrl:'https://make.powerapps.com/'},
 {...input,studioUrl:`https://apps.powerapps.com/play/e/${environmentId}/a/${appId}`},
 {...input,studioUrl:`https://make.powerapps.com/e/${environmentId}/canvas?action=edit`},
 {...input,studioUrl:input.studioUrl.replace('action=edit','action=new')},
 {...input,studioUrl:input.studioUrl+'&app-id='+appId},
 {...input,studioUrl:input.studioUrl+'&token=must-never-log'},
 {...input,studioUrl:input.studioUrl.replace(environmentId,'Default-33333333-3333-4333-8333-333333333333')},
 {...input,studioUrl:input.studioUrl.replace(appId,'33333333-3333-4333-8333-333333333333')},
 {...input,studioUrl:input.studioUrl.replace('make.powerapps.com','make.powerapps.com.attacker.test')},
])('rejects unsupported or drifting saved-app target before any process or source writes: %j',async target=>{
 const f=await fixture();await expect(verifyCanvasSourceSync(target,f.root,f.controller.signal,f.connect)).rejects.toThrow();expect(f.connect).not.toHaveBeenCalled();expect(await fs.readdir(f.root)).toEqual(['existing-source']);
});
it('accepts the supported provider-path and bare saved-app GUID without creating an experimental app',()=>{
 expect(savedCanvasTarget(input)).toEqual({environmentId,appId,account});expect(savedCanvasTarget({...input,studioUrl:input.studioUrl.replace('%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F','')})).toEqual({environmentId,appId,account});
});
it('records isolated native source observations while explicitly withholding compile/runtime/approval',async()=>{
 const f=await fixture(),result=await f.run();expect(result.status).toBe('source-sync-observed');expect(result.sourceSyncObserved).toBe(true);expect(result.cleanupVerified).toBe(true);expect(result.authoringApproved).toBe(false);expect(result.runtimeVerified).toBe(false);expect(result.files).toHaveLength(2);expect(result.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['connect','list_accounts','sync_canvas','list_accounts']);expect(f.call.mock.calls[0][1]).toEqual({environment_id:environmentId,app_id:appId,environment_category:'prod',login_hint:account});expect(f.workspace).not.toBe(f.existing);expect(await fs.readFile(path.join(f.existing,'App.pa.yaml'),'utf8')).toBe('preserved prior work');expect(f.close).toHaveBeenCalledOnce();
});
it.each(['native-empty','success-without-files','catalogue-only','error','binary','blank','oversized','unexpected-directory','linked-source','missing-app'])('blocks %s without overwriting old source',async mode=>{
 const f=await fixture(),base=f.call.getMockImplementation()!;
 f.call.mockImplementation(async(tool,args)=>{
  if(tool!=='sync_canvas')return base(tool,args);
  const dir=String(args.directoryPath);
  if(mode==='native-empty')return text('No files returned from server. Nothing written.');
  if(mode==='catalogue-only')return text('Power Apps Controls:\n- ModernButton');
  if(mode==='success-without-files')return text('Sync successful');
  if(mode==='error')return {...text('provider error containing private data'),isError:true};
  await base(tool,args);
  if(mode==='binary')await fs.writeFile(path.join(dir,'App.pa.yaml'),Buffer.from([255,0,254]));
  if(mode==='blank')await fs.writeFile(path.join(dir,'Screen1.pa.yaml'),' \r\n');
  if(mode==='oversized')await fs.writeFile(path.join(dir,'App.pa.yaml'),'x'.repeat(1024*1024+1));
  if(mode==='unexpected-directory')await fs.mkdir(path.join(dir,'nested'));
  if(mode==='missing-app')await fs.unlink(path.join(dir,'App.pa.yaml'));
  if(mode==='linked-source'){await fs.unlink(path.join(dir,'App.pa.yaml'));await fs.link(path.join(f.existing,'App.pa.yaml'),path.join(dir,'App.pa.yaml'));}
  return text('Synced source files');
 });
 const result=await f.run();expect(result.status).toBe('blocked');expect(result.sourceSyncObserved).toBe(false);expect(result.stage).toBe(['native-empty','error'].includes(mode)?'source-sync-response':'source-file-verification');expect(f.close).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('private data');expect(await fs.readFile(path.join(f.existing,'App.pa.yaml'),'utf8')).toBe('preserved prior work');
});
it.each(['wrong-connect-account','account-drift','source-drift','cleanup-failure','cancelled'])('revokes %s rather than preserving a successful observation',async mode=>{
 const f=await fixture(),base=f.call.getMockImplementation()!;let accountReads=0;
 f.call.mockImplementation(async(tool,args)=>{
  if(tool==='connect'&&mode==='wrong-connect-account')return text('Connected as other@example.test');
  if(tool==='list_accounts'&&++accountReads===2){
   if(mode==='account-drift')return text('Signed-in accounts:\n- other@example.test (connected)');
   if(mode==='source-drift')await fs.appendFile(path.join(f.workspace,'App.pa.yaml'),'# unexpected change\n');
   if(mode==='cancelled')f.controller.abort();
  }
  return base(tool,args);
 });
 if(mode==='cleanup-failure')f.close.mockRejectedValueOnce(new Error('private cleanup payload'));
 const result=await f.run();expect(result.status).toBe('blocked');expect(result.sourceSyncObserved).toBe(false);expect(f.close).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('private cleanup payload');
});
it('does not start a provider when already interrupted',async()=>{const f=await fixture();f.controller.abort();await expect(f.run()).rejects.toThrow();expect(f.connect).not.toHaveBeenCalled();});
