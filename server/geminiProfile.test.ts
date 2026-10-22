import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./exec.ts',()=>({run:vi.fn(async()=>'{"secure":true}')}));
import {run} from './exec.ts';
import {GEMINI_HOOK_SOURCE,geminiSettings,geminiHookCommand,verifyGeminiProfile} from './geminiBridge.ts';
const roots:string[]=[];
afterEach(async()=>{vi.clearAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-gemini-profile-'));roots.push(root);const profile=path.join(root,'settings.json'),hook=path.join(root,'gemini-hook.cjs'),entry=path.join(root,'gemini.js');
 const config=geminiSettings(geminiHookCommand(process.execPath,hook),{office:{httpUrl:'${CUBEFARM_OFFICE_URL}'}});await fs.writeFile(profile,JSON.stringify(config));await fs.writeFile(hook,GEMINI_HOOK_SOURCE);await fs.writeFile(path.join(root,'chunk-native.js'),'export {isFileAndDirectorySecureSync};');
 return {root,profile,hook,entry,config,command:{file:process.execPath,args:[entry]}};
}
it('rejects missing protected configuration before native validation',async()=>{
 const f=await fixture();await fs.rm(f.profile);expect(await verifyGeminiProfile(f.command,false,f.profile)).toContain('protected governance profile');expect(run).not.toHaveBeenCalled();
});
it.each(['old-helper','disabled-hooks','disabled-entry','missing-event','wrong-command','wrong-matcher','short-timeout','wrong-office','malformed-profile'])('rejects an unverifiable profile: %s',async change=>{
 const f=await fixture();if(change==='old-helper')await fs.writeFile(f.hook,'old helper');
 if(change==='disabled-hooks')f.config.hooksConfig.enabled=false;
 if(change==='disabled-entry')f.config.hooksConfig.disabled=['swarm-BeforeTool'];
 if(change==='missing-event')delete f.config.hooks.BeforeTool;
 if(change==='wrong-matcher')f.config.hooks.BeforeTool[0].matcher='never';
 if(change==='short-timeout')f.config.hooks.BeforeTool[0].hooks[0].timeout=1;
 if(change==='wrong-office')f.config.mcpServers.office={httpUrl:'http://unscoped.test'};
 if(change==='wrong-command')f.config.hooks.BeforeTool[0].hooks[0].command='unverified hook';
 await fs.writeFile(f.profile,change==='malformed-profile'?'invalid':JSON.stringify(f.config));expect(await verifyGeminiProfile(f.command,false,f.profile)).not.toBeNull();expect(run).not.toHaveBeenCalled();
});
it.each(['no-entry','no-export','false-verdict','invalid-verdict','native-error'])('refuses unverifiable native security validation: %s',async change=>{
 const f=await fixture();if(change==='no-entry')f.command.args=[];
 if(change==='no-export')await fs.writeFile(path.join(f.root,'chunk-native.js'),'export {};');
 if(change==='false-verdict')vi.mocked(run).mockResolvedValueOnce('{"secure":false}');
 if(change==='invalid-verdict')vi.mocked(run).mockResolvedValueOnce('{"secure":"true"}');
 if(change==='native-error')vi.mocked(run).mockRejectedValueOnce(new Error('Native startup failed'));
 expect(await verifyGeminiProfile(f.command,false,f.profile)).not.toBeNull();
});
it('admits only an intact profile and an explicit native security verdict',async()=>{
 const f=await fixture();expect(await verifyGeminiProfile(f.command,false,f.profile)).toBeNull();expect(run).toHaveBeenCalledOnce();const [,args,options]=vi.mocked(run).mock.calls[0];expect(args.slice(-1)).toEqual([f.profile]);expect(options).toMatchObject({timeoutMs:15000});
});
