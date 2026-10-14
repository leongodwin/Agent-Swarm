import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import crypto from 'node:crypto';

/** Match the default compressed-package inventory limit; stream without accepting a moving file. */
export async function stablePackageDigest(file:string,signal?:AbortSignal) {
  signal?.throwIfAborted();
  const before=await fs.lstat(file,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.size<=0n||before.size>64n*1024n*1024n)throw new Error('Deployment package is not a bounded regular file');
  const same=(a:typeof before,b:typeof before)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    if(!same(before,await handle.stat({bigint:true})))throw new Error('Deployment package changed while opening it');
    const hash=crypto.createHash('sha256');let bytes=0n;
    for await(const chunk of handle.createReadStream({autoClose:false,signal})) {bytes+=BigInt(chunk.length);if(bytes>before.size)throw new Error('Deployment package changed while reading it');hash.update(chunk);}
    signal?.throwIfAborted();
    if(bytes!==before.size||!same(before,await handle.stat({bigint:true}))||!same(before,await fs.lstat(file,{bigint:true})))throw new Error('Deployment package changed while reading it');
    return hash.digest('hex');
  }finally{await handle.close();}
}
