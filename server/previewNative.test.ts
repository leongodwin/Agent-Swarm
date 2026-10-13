import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {fork} from 'node:child_process';import {once} from 'node:events';import crypto from 'node:crypto';
import {expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({root:''}));
vi.mock('./workspace.ts',async original=>({...await original<typeof import('./workspace.ts')>(),prepareDesk:async()=>fixture.root,ensureLocalExcludes:async()=>{}}));
vi.mock('./exec.ts',async original=>({...await original<typeof import('./exec.ts')>(),git:async()=> 'owned-native-fixture'}));
import {realPreviews,portOpen} from './previewRunner.ts';
import {releaseDesk} from './workspace.ts';
import {HOME_DIR} from './config.ts';
it('stops a real owned preview process and observes its port close before returning',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-native-preview-'));fixture.root=root;
  const probe=net.createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  expect([4317,5317]).not.toContain(port);const script=path.join(root,'server.mjs');await fs.writeFile(script,`import http from 'node:http';import fs from 'node:fs';http.createServer((_req,res)=>res.end(JSON.stringify({inheritedSecretPresent:!!process.env.PREVIEW_PARENT_CREDENTIAL_CANARY,explicitProjectValue:process.env.PROJECT_CANARY,home:process.env.HOME,profileExists:fs.existsSync(process.env.HOME),tmpExists:fs.existsSync(process.env.TMP)}))).listen(Number(process.env.PORT),'127.0.0.1');`);
  vi.stubEnv('PREVIEW_PARENT_CREDENTIAL_CANARY','synthetic-parent-value');
  const status=vi.fn(),failed=vi.fn();const handle=realPreviews.start({fullName:'synthetic/native',defaultBranch:'main',pr:null,port,command:`"${process.execPath}" "${script}"`,env:{PROJECT_CANARY:'synthetic-project-value'},title:'Owned fixture'},{status,failed,commit:vi.fn(),log:vi.fn()});
  const profile=path.join(HOME_DIR,'preview-profiles',crypto.createHash('sha256').update('synthetic/native').digest('hex'));
  try{await vi.waitFor(()=>expect(status).toHaveBeenCalledWith('running'),{timeout:10000});expect(await portOpen(port)).toBe(true);expect(await (await fetch(`http://127.0.0.1:${port}`)).json()).toEqual({inheritedSecretPresent:false,explicitProjectValue:'synthetic-project-value',home:profile,profileExists:true,tmpExists:true});expect(path.relative(root,profile).startsWith('..')).toBe(true);await handle.stop();expect(await portOpen(port)).toBe(false);expect(failed).not.toHaveBeenCalled();}
  finally{vi.unstubAllEnvs();await handle.stop();await fs.rm(root,{recursive:true,force:true});await fs.rm(profile,{recursive:true,force:true});}
},20000);
it('does not terminate an unrelated owned fixture merely because it occupies the reserved port',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-foreign-preview-'));const script=path.join(root,'foreign.mjs');
  await fs.writeFile(script,`import http from 'node:http';const server=http.createServer((_req,res)=>res.end('Foreign fixture'));server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));process.on('message',()=>server.close(()=>{process.disconnect();}));`);
  const child=fork(script,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});const exit=once(child,'exit');
  try{const [message]=await once(child,'message');const port=(message as {port:number}).port;expect([4317,5317]).not.toContain(port);await releaseDesk('synthetic/foreign-case','preview',port);expect(child.exitCode).toBeNull();expect(await portOpen(port)).toBe(true);child.send('stop');await exit;}
  finally{if(child.exitCode===null&&child.signalCode===null)child.kill();await exit;await fs.rm(root,{recursive:true,force:true});}
},30000);
