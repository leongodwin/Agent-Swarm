import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {stablePackageDigest} from './deliveryPackage.ts';
const roots:string[]=[];
async function file(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-package-'));roots.push(root);const file=path.join(root,'release.zip');await fs.writeFile(file,'PK synthetic package');return file;}
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
it('hashes a stable package without loading the entire archive into memory',async()=>{const name=await file();expect(await stablePackageDigest(name)).toBe(crypto.createHash('sha256').update('PK synthetic package').digest('hex'));});
it.each(['empty','directory','oversized'] as const)('rejects %s package files',async mode=>{const name=await file();if(mode==='empty')await fs.truncate(name,0);if(mode==='oversized')await fs.truncate(name,65*1024*1024);await expect(stablePackageDigest(mode==='directory'?path.dirname(name):name)).rejects.toThrow('bounded regular file');});
it('does not open a package after cancellation',async()=>{const name=await file(),controller=new AbortController();controller.abort();const open=vi.spyOn(fs,'open');await expect(stablePackageDigest(name,controller.signal)).rejects.toThrow();expect(open).not.toHaveBeenCalled();});
it('rejects same-byte path replacement between inspection and opening and closes its descriptor',async()=>{
  const name=await file(),open=fs.open.bind(fs);let opened:Awaited<ReturnType<typeof fs.open>>;
  vi.spyOn(fs,'open').mockImplementationOnce(async(...args)=>{const handle=await open(...args);opened=handle;await fs.rename(name,name+'.old');await fs.writeFile(name,'PK synthetic package');return handle;});
  await expect(stablePackageDigest(name)).rejects.toThrow('package changed');await expect(opened!.stat()).rejects.toThrow();
});
it('rejects growth during the descriptor read and closes it',async()=>{
  const name=await file(),open=fs.open.bind(fs);let opened:Awaited<ReturnType<typeof fs.open>>;
  vi.spyOn(fs,'open').mockImplementationOnce(async(...args)=>{const handle=await open(...args),stream=handle.createReadStream.bind(handle);opened=handle;vi.spyOn(handle,'createReadStream').mockImplementation(options=>(async function*(){for await(const chunk of stream(options)){await fs.appendFile(name,'unreviewed growth');yield chunk;}})() as any);return handle;});
  await expect(stablePackageDigest(name)).rejects.toThrow('changed while reading');await expect(opened!.stat()).rejects.toThrow();
});
