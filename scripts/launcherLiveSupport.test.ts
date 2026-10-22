import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {stopVerificationKeeper} from './launcherLiveSupport.ts';
it('refuses an unrelated home before reading its keeper secret or touching native processes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-unrelated-qa-')),home=path.join(root,'home');await fs.mkdir(home);
 await fs.writeFile(path.join(home,'pty.secret'),'synthetic-secret');const kill=vi.spyOn(process,'kill');
 try{await expect(stopVerificationKeeper(home)).rejects.toThrow('Unexpected isolated keeper scope');expect(kill).not.toHaveBeenCalled();expect(await fs.readFile(path.join(home,'pty.secret'),'utf8')).toBe('synthetic-secret');}
 finally{kill.mockRestore();await fs.rm(root,{recursive:true,force:true});}
});
it('refuses a symlinked verification home before connecting to a keeper',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-launcher-live-')),real=path.join(root,'real'),home=path.join(root,'home');await fs.mkdir(real);await fs.symlink(real,home,process.platform==='win32'?'junction':'dir');
 try{await expect(stopVerificationKeeper(home)).rejects.toThrow('Unexpected isolated keeper scope');}
 finally{await fs.rm(home,{force:true});await fs.rm(root,{recursive:true,force:true});}
});
