import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {runNativeTree,windowsArgument} from './nativeTree.ts';
it('quotes Windows arguments only when needed by the native parser',()=>{expect(windowsArgument('solution')).toBe('solution');expect(windowsArgument('--environment')).toBe('--environment');expect(windowsArgument('')).toBe('""');expect(windowsArgument('a b')).toBe('"a b"');expect(windowsArgument('a"b')).toBe('"a\\"b"');expect(windowsArgument('C:\\with space\\')).toBe('"C:\\with space\\\\"');});
it.skipIf(process.platform!=='win32')('observes real Job Object termination before acknowledging native success',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-job-test-')),context={id:crypto.randomUUID(),intentSha256:'a'.repeat(64),proof:path.join(root,'proof.json')};
 try{expect(await runNativeTree(process.execPath,['-e','process.stdout.write("GBP £ 東京")'],root,{},new AbortController().signal,context)).toBe('GBP £ 東京');expect(JSON.parse(await fs.readFile(context.proof,'utf8'))).toMatchObject({id:context.id,activeProcesses:0,nativeTreeQuiescenceVerified:true,breakawayAllowed:false});}
 finally{await fs.rm(root,{recursive:true,force:true});}
},20000);
it.skipIf(process.platform!=='win32')('retains a provider code reported on stdout when the process rejects',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-provider-stdout-')),context={id:crypto.randomUUID(),intentSha256:'a'.repeat(64),proof:path.join(root,'proof.json'),errorOutput:path.join(root,'private-error.json')};
 try{await expect(runNativeTree(process.execPath,['-e','console.log("ERROR: HTTP 404: [0x80060888] Missing test resource");process.exit(1)'],root,{},new AbortController().signal,context)).rejects.toMatchObject({platformErrorCode:'0x80060888',message:expect.stringContaining('HTTP 404')});expect(JSON.parse(await fs.readFile(context.proof,'utf8')).activeProcesses).toBe(0);expect(JSON.parse(await fs.readFile(context.errorOutput,'utf8'))).toMatchObject({stdout:expect.stringContaining('0x80060888'),stderr:''});}finally{await fs.rm(root,{recursive:true,force:true});}
},20000);
it.skipIf(process.platform!=='win32').each(['exit','invalid-utf8','cancel','quoted-argument'])('enforces native supervision for %s',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-job-errors-')),context={id:crypto.randomUUID(),intentSha256:'b'.repeat(64),proof:path.join(root,'proof.json')},controller=new AbortController();
 try{
  const args=mode==='exit'?['-e','process.stderr.write("provider failure");process.exit(7)']:mode==='invalid-utf8'?['-e','process.stdout.write(Buffer.from([255]))']:mode==='quoted-argument'?['-e','process.stdout.write(process.argv[1])','path with spaces "quote" \\']:['-e','process.stdout.write("started");setInterval(()=>{},1000)'];
  const result=runNativeTree(process.execPath,args,root,{},controller.signal,context);
  if(mode==='cancel'){const rejection=expect(result).rejects.toThrow('cancelled');setTimeout(()=>controller.abort(),1500);await rejection;}
  else if(mode==='quoted-argument')expect(await result).toBe(args[2]);
  else await expect(result).rejects.toThrow(mode==='exit'?'provider failure':'invalid UTF-8');
  expect(JSON.parse(await fs.readFile(context.proof,'utf8')).activeProcesses).toBe(0);
 }finally{controller.abort();await fs.rm(root,{recursive:true,force:true});}
},20000);
it('refuses an already cancelled command before spawning any supervisor',async()=>{const controller=new AbortController();controller.abort();await expect(runNativeTree(process.execPath,[],process.cwd(),{},controller.signal,{id:crypto.randomUUID(),intentSha256:'c'.repeat(64),proof:'unused'})).rejects.toThrow();});
it.skipIf(process.platform!=='win32').each(['nul','oversized'])('rejects %s native input before process creation',async fault=>{await expect(runNativeTree(process.execPath,[fault==='nul'?'bad\0argument':'x'.repeat(30001)],process.cwd(),{},new AbortController().signal,{id:crypto.randomUUID(),intentSha256:'e'.repeat(64),proof:'unused'})).rejects.toThrow('Invalid or oversized');});
it('refuses unsupported native proof platforms',async()=>{const spy=vi.spyOn(process,'platform','get').mockReturnValue('linux');try{await expect(runNativeTree(process.execPath,[],process.cwd(),{},new AbortController().signal,{id:crypto.randomUUID(),intentSha256:'e'.repeat(64),proof:'unused'})).rejects.toThrow('Windows');}finally{spy.mockRestore();}});
it.skipIf(process.platform!=='win32').each(['truncated-utf8','excess-output','silent-failure'])('preserves proof but rejects %s native results',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-job-output-')),context={id:crypto.randomUUID(),intentSha256:'f'.repeat(64),proof:path.join(root,'proof.json')};
 try{const script=mode==='truncated-utf8'?'process.stdout.write(Buffer.from([226,130]))':mode==='excess-output'?'process.stdout.write(Buffer.alloc(8*1024*1024+1));setInterval(()=>{},1000)':'process.exit(9)';await expect(runNativeTree(process.execPath,['-e',script],root,{},new AbortController().signal,context)).rejects.toThrow(mode==='truncated-utf8'?'invalid UTF-8':mode==='excess-output'?'exceeded its limit':'exit 9');expect(JSON.parse(await fs.readFile(context.proof,'utf8')).activeProcesses).toBe(0);}finally{await fs.rm(root,{recursive:true,force:true});}
},20000);
