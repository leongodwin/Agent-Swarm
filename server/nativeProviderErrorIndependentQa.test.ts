import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {expect,it} from 'vitest';
import {runNativeTree} from './nativeTree.ts';
import {providerErrorCode} from './platformCommandError.ts';

it('accepts exact provider codes and refuses unrelated or malformed error text',()=>{
 expect(providerErrorCode('ERROR: HTTP 404: [0x80060888] Missing entity')).toBe('0x80060888');
 expect(providerErrorCode('{"error":{"code":"0x80060888"}}')).toBe('0x80060888');
 for(const text of ['info 0x80060888','ERROR: HTTP 404: [0x8006088]','{"error":{"code":"secret"}}','{'])expect(providerErrorCode(text)).toBeUndefined();
});

it.skipIf(process.platform!=='win32')('retains JSON stdout provider code when stderr also contains diagnostics',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-provider-independent-'));
 const context={id:crypto.randomUUID(),intentSha256:'c'.repeat(64),proof:path.join(root,'proof.json')};
 try{
  const script='process.stdout.write(JSON.stringify({error:{code:"0x80060888",message:"missing entity"}}));process.stderr.write("CLI diagnostic warning");process.exitCode=1;';
  await expect(runNativeTree(process.execPath,['-e',script],root,{},new AbortController().signal,context)).rejects.toMatchObject({platformErrorCode:'0x80060888'});
  expect(JSON.parse(await fs.readFile(context.proof,'utf8'))).toMatchObject({activeProcesses:0,nativeTreeQuiescenceVerified:true});
 }finally{await fs.rm(root,{recursive:true,force:true});}
},20000);
