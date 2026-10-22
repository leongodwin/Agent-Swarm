import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./exec.ts',()=>({run:vi.fn()}));
import {run} from './exec.ts';
import {GEMINI_HOOK_SOURCE,geminiSettings,geminiHookCommand,verifyGeminiProfile} from './geminiBridge.ts';
const exec=promisify(execFile),roots:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.mocked(run).mockReset();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(secure:boolean){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-env-independent-'));roots.push(root);
 const hook=path.join(root,'gemini-hook.cjs'),profile=path.join(root,'settings.json'),entry=path.join(root,'gemini.js');
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 await fs.writeFile(hook,GEMINI_HOOK_SOURCE);
 await fs.writeFile(profile,JSON.stringify(geminiSettings(geminiHookCommand(process.execPath,hook),{office:{httpUrl:'${CUBEFARM_OFFICE_URL}'}})));
 await fs.writeFile(path.join(root,'chunk-security.js'),`function isFileAndDirectorySecureSync(profile){if(process.platform==='win32'&&process.env.PSModulePath!==undefined)throw new Error('Inherited PowerShell module path');if(process.platform!=='win32'&&process.env.PSModulePath!=='synthetic-parent-module-path')throw new Error('Unrelated platform environment was changed');return {secure:${secure}};}export {isFileAndDirectorySecureSync};`);
 vi.mocked(run).mockImplementation(async(file,args)=>{const result=await exec(file,args,{timeout:15000,encoding:'utf8'});return result.stdout;});
 return {profile,command:{file:process.execPath,args:[entry]}};
}
it.each([true,false])('keeps native security verdict authoritative after isolated module-path repair: %s',async secure=>{
 vi.stubEnv('PSModulePath','synthetic-parent-module-path');const f=await fixture(secure);
 const result=await verifyGeminiProfile(f.command,false,f.profile);
 if(secure)expect(result).toBeNull();else expect(result).toContain('Gemini rejected');
 expect(run).toHaveBeenCalledOnce();expect(process.env.PSModulePath).toBe('synthetic-parent-module-path');
});
