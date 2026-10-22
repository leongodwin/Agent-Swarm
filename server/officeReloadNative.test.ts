import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it,vi} from 'vitest';

it.each(['dev','built'])('reloads an owned native %s launcher without a source change and preserves maintenance',async mode=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-native-reload-')),home=path.join(root,'home');
  const probe=net.createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  expect([4317,5317]).not.toContain(port);
  for(const dir of ['scripts','server','shared','bin','node_modules','node_modules/vite/bin','home'])await fs.mkdir(path.join(root,dir),{recursive:true});
  for(const name of ['zod','tsx'])await fs.symlink(path.resolve('node_modules',name),path.join(root,'node_modules',name),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(root,'package.json'),' {"type":"module","private":true}');
  for(const file of ['scripts/office.mjs','scripts/officeSteps.mjs','scripts/officeRecovery.mjs','server/policyReaderHost.mjs','server/officeReload.mjs'])await fs.copyFile(path.resolve(file),path.join(root,file));
  await fs.writeFile(path.join(root,'node_modules/vite/bin/vite.js'),'setInterval(()=>{},1000);');
  await fs.writeFile(path.join(home,'maintenance.json'),JSON.stringify({version:1,draining:true}));
  const module=(name:string)=>new URL(name,import.meta.url).href;
  const source=`import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
    const {createOfficeHttpApp}=await import(${JSON.stringify(module('./officeHttp.ts'))});
    const {OfficeMaintenance}=await import(${JSON.stringify(module('./officeMaintenance.ts'))});
    const {OfficeReloadRequester}=await import(${JSON.stringify(module('./officeReload.mjs'))});
    const home=process.env.SWARM_HOME;const maintenance=new OfficeMaintenance(path.join(home,'maintenance.json'));await maintenance.init();
    const reload=new OfficeReloadRequester();await reload.probe();
    const swarm={isDraining:maintenance.draining,sessionUsage:()=>({limit:0,used:0,agentSessions:0,freeSlots:null,auxiliary:[]}),snapshot:()=>({settings:{defaultCli:'codex'},agents:[],repos:[],draining:maintenance.draining})};
    const delivery={isDraining:maintenance.draining,view:()=>({running:false,policy:{copilotPaused:true}})};
    const {app}=createOfficeHttpApp({backend:{demo:false,tenancy:{activity:()=>({scope:'process-local-tenancy-work',closed:false,profileSelection:false,authenticationRequests:0,awaitingNativeExit:0,nativeCommands:0,busy:false})}},swarm,delivery,capabilities:{view:()=>({})},features:{},toolGovernance:{},tenantDlp:{},canvasOwnership:{},homeDir:home,runtimeStartedAt:new Date().toISOString(),policyReaderMode:'launcher',officeReload:reload});
    const server=http.createServer(app);process.on('message',msg=>{if(msg?.type==='office:shutdown'){reload.close();server.closeAllConnections();server.close(()=>process.exit(0));}});
    server.listen(Number(process.env.SWARM_PORT),'127.0.0.1',async()=>{await fs.writeFile(path.join(home,'fixture-process.json'),JSON.stringify({pid:process.pid,parentPid:process.ppid}));reload.ready();});`;
  await fs.writeFile(path.join(root,'server/index.ts'),source);
  await fs.writeFile(path.join(root,'bin/cubefarm.js'),`import {register} from 'tsx/esm/api';register();await import('../server/index.ts');`);
  const before=await fs.stat(path.join(root,'server/index.ts'));let output='';
  const child=spawn(process.execPath,[path.join(root,'scripts/office.mjs'),...(mode==='dev'?['--dev']:[]),'--no-open'],{cwd:root,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,SWARM_HOME:home,SWARM_LEASE_ROOT:path.join(home,'leases'),SWARM_PORT:String(port),SWARM_CLIENT_PORT:'0'}});
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  const exited=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
  const url=`http://127.0.0.1:${port}`;
  const read=async()=>{
    const session=await fetch(url+'/api/session',{signal:AbortSignal.timeout(1000)});const cookie=session.headers.get('set-cookie')!.split(';')[0];
    const response=await fetch(url+'/api/runtime',{headers:{Cookie:cookie},signal:AbortSignal.timeout(1000)});
    return {runtime:await response.json(),cookie};
  };
  try{
    let first:Awaited<ReturnType<typeof read>>|undefined;
    await vi.waitFor(async()=>{first=await read();expect(first.runtime.reload.supported).toBe(true);},{timeout:15000,interval:100});
    const response=await fetch(url+'/api/office/reload',{method:'POST',headers:{Cookie:first!.cookie,'Content-Type':'application/json'},body:JSON.stringify({expectedPid:first!.runtime.pid})});
    expect(response.status).toBe(202);const accepted=await response.json();
    let second:Awaited<ReturnType<typeof read>>|undefined;
    await vi.waitFor(async()=>{second=await read();expect(second.runtime.pid).not.toBe(first!.runtime.pid);expect(second.runtime.reload.phase).toBe('ready');},{timeout:15000,interval:100});
    expect(second!.runtime).toMatchObject({draining:true,demo:false,authenticationWork:{scope:'process-local-tenancy-work',busy:false},reload:{supported:true,sourcePid:first!.runtime.pid,targetPid:second!.runtime.pid,operationId:accepted.operationId}});
    expect(JSON.parse(await fs.readFile(path.join(home,'fixture-process.json'),'utf8'))).toEqual({pid:second!.runtime.pid,parentPid:child.pid});
    expect(JSON.parse(await fs.readFile(path.join(home,'maintenance.json'),'utf8'))).toEqual({version:1,draining:true});
    expect((await fs.stat(path.join(root,'server/index.ts'))).mtimeMs).toBe(before.mtimeMs);
    expect(output).toContain('Reloading the idle office through the owning launcher');
    expect(output).not.toContain('Restarting:');
  }catch(error){throw new Error(`Owned launcher fixture failed: ${output}`,{cause:error});}
  finally{
    if(child.exitCode===null&&child.signalCode===null&&child.pid){
      if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
      else try{process.kill(-child.pid,'SIGTERM');}catch{}
    }
    await exited;await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
},45000);
