import {expect,it,vi} from 'vitest';
import {establishCodexHookTrust,type HookRpc} from './codexHookTrust.ts';
const cwd='C:/synthetic/desk',hash=`sha256:${'a'.repeat(64)}`,spec={event:'PreToolUse',command:'node "owned-hook.cjs" --event PreToolUse',timeout:10};
function fixture(){
 const hook:any={key:'native-key',eventName:'preToolUse',handlerType:'command',command:spec.command,source:'sessionFlags',enabled:true,isManaged:false,currentHash:hash,trustStatus:'untrusted',matcher:null,timeoutSec:10,async:false};
 const writes:any[]=[],source=vi.fn(async()=>{});let reads=0;
 const rpc:HookRpc={close:vi.fn(async()=>{}),request:vi.fn(async(method,params:any)=>{
   if(method==='configRequirements/read')return {requirements:null};
   if(method==='hooks/list'){reads++;return {data:[{cwd,hooks:[{...hook}],warnings:[],errors:[]}]};}
   if(method==='config/read')return {config:{features:{hooks:true}},layers:[{name:{type:'user',profile:null,file:'C:/synthetic/config.toml'},version:'native-version'}]};
   if(method==='config/value/write'){writes.push(params);hook.trustStatus='trusted';return {status:'ok',overriddenMetadata:null};}
   throw new Error('Unexpected request');
 })};return {rpc,hook,writes,source,reads:()=>reads};
}
it('trusts only the exact native hash and verifies readback with a source check around writes',async()=>{
 const f=fixture();expect(await establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).toEqual({verified:1,hashes:[hash]});expect(f.writes).toEqual([{keyPath:'hooks.state."native-key".trusted_hash',value:hash,mergeStrategy:'upsert',filePath:'C:/synthetic/config.toml',expectedVersion:'native-version'}]);expect(f.source).toHaveBeenCalledTimes(3);
});
it('does not rewrite trust for an already verified hook',async()=>{const f=fixture();f.hook.trustStatus='trusted';await establishCodexHookTrust(f.rpc,cwd,[spec],f.source);expect(f.writes).toEqual([]);});
it.each(['disabled','managed','wrong-source','wrong-command','wrong-timeout','partial-matcher','async','missing'])('refuses an unverified required hook: %s',async change=>{
 const f=fixture();if(change==='disabled')f.hook.enabled=false;if(change==='managed')f.hook.isManaged=true;if(change==='wrong-source')f.hook.source='plugin';if(change==='wrong-command')f.hook.command='foreign';if(change==='wrong-timeout')f.hook.timeoutSec=1;if(change==='partial-matcher')f.hook.matcher='OnlyOneTool';if(change==='async')f.hook.async=true;if(change==='missing')f.hook.eventName='sessionStart';
 await expect(establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).rejects.toThrow();expect(f.writes).toEqual([]);
});
it('refuses changed helper bytes before making trust changes',async()=>{const f=fixture();f.source.mockRejectedValueOnce(new Error('Source changed'));await expect(establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).rejects.toThrow('Source changed');expect(f.writes).toEqual([]);});
it('rejects readback hash changes despite a successful configuration write',async()=>{
 const f=fixture(),request=f.rpc.request;f.rpc.request=async(method,params)=>{const result=await request(method,params);if(method==='config/value/write')f.hook.currentHash=`sha256:${'b'.repeat(64)}`;return result;};await expect(establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).rejects.toThrow('readback changed');
});
it('never approves unrelated inherited hooks',async()=>{
 const f=fixture(),request=f.rpc.request;f.rpc.request=async(method,params)=>{const result=await request(method,params);if(method==='hooks/list')result.data[0].hooks.push({...f.hook,key:'foreign-key',command:'foreign command',source:'plugin',trustStatus:'untrusted'});return result;};await establishCodexHookTrust(f.rpc,cwd,[spec],f.source);expect(f.writes).toHaveLength(1);expect(f.writes[0].keyPath).not.toContain('foreign');
});
it.each(['disabled-feature','managed-only','unknown-policy','missing-version','write-override'])('fails closed on native policy or persistence uncertainty: %s',async change=>{
 const f=fixture(),request=f.rpc.request;f.rpc.request=async(method,params)=>{
   const result=await request(method,params);
   if(change==='disabled-feature'&&method==='config/read')result.config.features.hooks=false;
   if(change==='managed-only'&&method==='configRequirements/read')result.requirements={allowManagedHooksOnly:true};
   if(change==='unknown-policy'&&method==='configRequirements/read')return {};
   if(change==='missing-version'&&method==='config/read')result.layers=[];
   if(change==='write-override'&&method==='config/value/write')result.overriddenMetadata={reason:'Managed policy'};
   return result;
 };await expect(establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).rejects.toThrow();
});

it.each(['null-policy','invalid-policy','feature-denial','outside-cwd','inventory-errors','ambiguous','wrong-handler','profile-only','missing-file','missing-version-type','write-failure','readback-key','readback-untrusted'] as const)('denies uncertain authority without granting verified hook readiness: %s',async mode=>{
 const f=fixture(),request=f.rpc.request;let inventories=0;
 f.rpc.request=async(method,params)=>{
  const result=await request(method,params);
  if(method==='configRequirements/read'){
   if(mode==='null-policy')return null;
   if(mode==='invalid-policy')return {requirements:{allowManagedHooksOnly:'unknown'}};
   if(mode==='feature-denial')return {requirements:{allowManagedHooksOnly:null,featureRequirements:{hooks:false}}};
  }
  if(method==='hooks/list'){
   inventories++;
   if(mode==='outside-cwd')result.data[0].cwd='C:/synthetic/foreign';
   if(mode==='inventory-errors')result.data[0].errors=['native inventory unavailable'];
   if(mode==='ambiguous')result.data[0].hooks.push({...f.hook});
   if(mode==='wrong-handler')result.data[0].hooks[0].handlerType='prompt';
   if(inventories===2&&mode==='readback-key')result.data[0].hooks[0].key='replacement';
   if(inventories===2&&mode==='readback-untrusted')result.data[0].hooks[0].trustStatus='untrusted';
  }
  if(method==='config/read'){
   if(mode==='profile-only')result.layers[0].name.profile='other';
   if(mode==='missing-file')delete result.layers[0].name.file;
   if(mode==='missing-version-type')result.layers[0].version=1;
  }
  if(method==='config/value/write'&&mode==='write-failure')return {status:'error'};
  return result;
 };
 await expect(establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).rejects.toThrow();
 expect(f.writes).toHaveLength(['write-failure','readback-key','readback-untrusted'].includes(mode)?1:0);
});
it.each(['','*','.*'])('accepts native unrestricted matcher %j while requiring exact source and hash',async matcher=>{
 const f=fixture();f.hook.matcher=matcher;expect(await establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).toEqual({verified:1,hashes:[hash]});expect(f.writes).toHaveLength(1);
});
it('rejects a changed source at the write boundary before persisting trust',async()=>{
 const f=fixture();f.source.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Source changed before write'));
 await expect(establishCodexHookTrust(f.rpc,cwd,[spec],f.source)).rejects.toThrow('Source changed before write');expect(f.writes).toEqual([]);
});
