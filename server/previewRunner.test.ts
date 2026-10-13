import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({root:'',prepare:vi.fn(),launch:vi.fn(),listening:false}));
vi.mock('./workspace.ts',()=>({prepareDesk:(...args:unknown[])=>mock.prepare(...args),ensureLocalExcludes:async()=>{},mainDir:()=>mock.root}));
vi.mock('./exec.ts',()=>({git:async()=> 'abcdef'}));
vi.mock('node:child_process',()=>({spawn:(...args:unknown[])=>mock.launch(...args)}));
vi.mock('node:net',()=>({default:{connect:()=>{const socket=new EventEmitter() as EventEmitter&{destroy:()=>void;setTimeout:()=>void};socket.destroy=()=>{};socket.setTimeout=()=>{};queueMicrotask(()=>socket.emit(mock.listening?'connect':'error',new Error('Synthetic socket')));return socket;}}}));
import {realPreviews,defaultCommand,previewEnv,type PreviewCallbacks} from './previewRunner.ts';
class Child extends EventEmitter {
  pid=900001;exitCode:number|null=null;signalCode:string|null=null;stdout=new PassThrough();stderr=new PassThrough();
  kill=vi.fn(()=>{this.finish(null);return true;});
  finish(code:number|null){this.exitCode=code;this.signalCode=code===null?'SIGKILL':null;this.emit('close',code);}
}
let active:Child|undefined;const roots:string[]=[];
beforeEach(async()=>{
  mock.root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-preview-unit-'));roots.push(mock.root);mock.prepare.mockReset().mockResolvedValue(mock.root);mock.launch.mockReset();mock.listening=false;
  vi.spyOn(process,'kill').mockImplementation(()=>{active?.finish(null);return true;});
  mock.launch.mockImplementation((cmd:string)=>{
    if(cmd==='taskkill'){const task=new Child();queueMicrotask(()=>{active?.finish(null);task.finish(0);});return task;}
    active=new Child();return active;
  });
});
afterEach(async()=>{active?.finish(0);active=undefined;vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const callbacks=():PreviewCallbacks=>({status:vi.fn(),commit:vi.fn(),log:vi.fn(),failed:vi.fn()});
const job=()=>({fullName:'synthetic/repo',defaultBranch:'main',pr:null,port:65001,command:'synthetic-server',env:{},title:'Synthetic'});
it('joins in-progress checkout before stop completes and performs no later launch',async()=>{
  let finish!:(value:string)=>void;mock.prepare.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const cb=callbacks(),handle=realPreviews.start(job(),cb);
  await vi.waitFor(()=>expect(mock.prepare).toHaveBeenCalledOnce());let done=false;const stop=handle.stop().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);
  finish(mock.root);await stop;expect(mock.launch).not.toHaveBeenCalled();expect(cb.commit).not.toHaveBeenCalled();
});
it('can be stopped before its first preparation callback',async()=>{
  const cb=callbacks(),handle=realPreviews.start(job(),cb);await handle.stop();expect(mock.prepare).not.toHaveBeenCalled();expect(cb.status).not.toHaveBeenCalled();
});
it('honors a reentrant stop from the preparing consumer without checking out a desk',async()=>{
  const cb=callbacks();let handle:ReturnType<typeof realPreviews.start>;cb.status=vi.fn(()=>handle.stop());handle=realPreviews.start(job(),cb);
  await vi.waitFor(()=>expect(cb.status).toHaveBeenCalledOnce());await handle.stop();expect(mock.prepare).not.toHaveBeenCalled();
});
it('reports unconfigured projects and detects actual package presence',async()=>{
  const cb=callbacks(),handle=realPreviews.start({...job(),command:null},cb);await vi.waitFor(()=>expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('Nothing to run'),true));await handle.stop();
  expect(await realPreviews.hasDefault('synthetic/repo')).toBe(false);await fs.writeFile(path.join(mock.root,'package.json'),'{}');expect(await realPreviews.hasDefault('synthetic/repo')).toBe(true);
});
it('isolates throwing/rejecting consumers while observing process output and exit',async()=>{
  const cb=callbacks();cb.status=vi.fn(()=>{throw new Error('Private callback failure');});cb.log=vi.fn(async()=>{throw new Error('Private log failure');});const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const handle=realPreviews.start(job(),cb);await vi.waitFor(()=>expect(active).toBeDefined());active!.stdout.write('first\npartial');active!.stderr.write('\x1b[31mred\x1b[0m\n');active!.finish(7);
  await vi.waitFor(()=>expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('code 7')));await handle.stop();expect(cb.log).toHaveBeenCalled();expect(warn.mock.calls.flat().join(' ')).not.toContain('Private');
});
it('clears the installation deadline after success and skips an unchanged package on restart',async()=>{
  await fs.writeFile(path.join(mock.root,'package.json'),JSON.stringify({scripts:{dev:'vite'}}));await fs.mkdir(path.join(mock.root,'node_modules'));
  mock.launch.mockImplementation((cmd:string)=>{const child=new Child();if(cmd==='npm install'){queueMicrotask(()=>child.finish(0));return child;}if(cmd==='taskkill'){queueMicrotask(()=>{active?.finish(null);child.finish(0);});return child;}active=child;return child;});
  const timers=vi.spyOn(globalThis,'setTimeout');const clear=vi.spyOn(globalThis,'clearTimeout');const cb=callbacks(),handle=realPreviews.start(job(),cb);
  await vi.waitFor(()=>expect(mock.launch.mock.calls.some(([cmd])=>cmd==='synthetic-server')).toBe(true));
  const index=timers.mock.calls.findIndex(([,ms])=>ms===15*60_000);expect(index).toBeGreaterThanOrEqual(0);expect(clear).toHaveBeenCalledWith(timers.mock.results[index].value);
  await handle.stop();mock.launch.mockClear();const next=realPreviews.start(job(),callbacks());await vi.waitFor(()=>expect(mock.launch).toHaveBeenCalled());expect(mock.launch.mock.calls.some(([cmd])=>cmd==='npm install')).toBe(false);await next.stop();
});
it('chooses deterministic default commands and isolates inherited office/provider variables',()=>{
  expect(defaultCommand(null)).toBeNull();expect(defaultCommand({scripts:{dev:'vite'}})).toBe('npm run dev -- --port {port} --strictPort');expect(defaultCommand({scripts:{dev:'vite --port 123',start:'node app'}})).toBe('npm run dev');expect(defaultCommand({scripts:{start:'node app'}})).toBe('npm run start');
  vi.stubEnv('SWARM_HOME','private-office');vi.stubEnv('ANTHROPIC_API_KEY','private-key');const env=previewEnv({VALUE:'{port}:{tmp}'},123,'fixture');expect(env.SWARM_HOME).toBeUndefined();expect(env.ANTHROPIC_API_KEY).toBeUndefined();expect(env.VALUE).toBe('123:fixture');expect(env.PORT).toBe('123');
});
it('does not implicitly transfer arbitrary secrets, authentication sockets or Node preload configuration',()=>{
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','AZURE_CLIENT_SECRET','ARM_CLIENT_SECRET','DATAVERSE_TOKEN','NPM_TOKEN','AWS_SECRET_ACCESS_KEY','SSH_AUTH_SOCK','NODE_OPTIONS','UNRECOGNISED_PRIVATE_SETTING','LC_PRIVATE_SECRET'])vi.stubEnv(key,'synthetic-private-value');
  vi.stubEnv('PATH','synthetic-runtime-path');vi.stubEnv('SystemRoot','synthetic-system-root');
  const env=previewEnv({},123,mock.root);expect(env.PATH).toBe('synthetic-runtime-path');expect(Object.entries(env).find(([key])=>key.toLowerCase()==='systemroot')?.[1]).toBe('synthetic-system-root');
  expect(Object.values(env)).not.toContain('synthetic-private-value');expect(env.HOME).toBe(path.join(mock.root,'profile'));expect(env.USERPROFILE).toBe(env.HOME);expect(env.TEMP).toBe(path.join(env.HOME,'tmp'));
});
it('accepts explicitly configured project values but rejects retired provider credentials even through direct callers',()=>{
  expect(previewEnv({PROJECT_API_KEY:'project-specific',XDG_CONFIG_HOME:'{tmp}/project-config'},123,mock.root)).toMatchObject({PROJECT_API_KEY:'project-specific',XDG_CONFIG_HOME:mock.root+'/project-config'});
  expect(()=>previewEnv({ANTHROPIC_API_KEY:'synthetic'},123,mock.root)).toThrow('not permitted');expect(()=>previewEnv({CLAUDE_CONFIG_DIR:'synthetic'},123,mock.root)).toThrow('not permitted');
});
it.runIf(process.platform==='win32')('merges explicit Windows environment keys case-insensitively and reserves PORT',()=>{
  vi.stubEnv('PATH','synthetic-inherited-path');const env=previewEnv({Path:'project-runtime-path',port:'9999'},123,mock.root);
  expect(Object.entries(env).filter(([key])=>key.toLowerCase()==='path')).toEqual([['Path','project-runtime-path']]);expect(Object.entries(env).filter(([key])=>key.toLowerCase()==='port')).toEqual([['PORT','123']]);
});
it('does not turn a cleanup timeout into root-exit acknowledgement and permits a later verified retry',async()=>{
  vi.useFakeTimers();vi.mocked(process.kill).mockImplementation(()=>true);mock.launch.mockImplementation((cmd:string)=>{if(cmd==='taskkill'){const task=new Child();queueMicrotask(()=>task.finish(1));return task;}active=new Child();return active;});
  const cb=callbacks(),handle=realPreviews.start(job(),cb);await vi.waitFor(()=>expect(active).toBeDefined());const pending=expect(handle.stop()).rejects.toThrow('root exit is unverified');
  await vi.advanceTimersByTimeAsync(5100);await pending;expect(active!.exitCode).toBeNull();active!.finish(0);await handle.stop();expect(cb.failed).not.toHaveBeenCalled();
});
it('blocks startup after a failed dependency install and uses ci when the lockfile is present',async()=>{
  await fs.writeFile(path.join(mock.root,'package.json'),'{}');await fs.writeFile(path.join(mock.root,'package-lock.json'),'{}');
  mock.launch.mockImplementation((cmd:string)=>{const child=new Child();expect(cmd).toBe('npm ci');queueMicrotask(()=>child.finish(2));return child;});
  const cb=callbacks(),handle=realPreviews.start(job(),cb);await vi.waitFor(()=>expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('npm ci failed')));await handle.stop();expect(mock.launch).toHaveBeenCalledOnce();
});
it('records spawn failure without reporting a listening preview',async()=>{
  mock.launch.mockImplementation(()=>{const child=new Child();Object.defineProperty(child,'pid',{value:undefined});queueMicrotask(()=>child.emit('error',new Error('Synthetic launch failure')));return child;});
  const cb=callbacks(),handle=realPreviews.start(job(),cb);await vi.waitFor(()=>expect(cb.failed).toHaveBeenCalledWith(expect.stringContaining('code -1')));await handle.stop();expect(cb.status).not.toHaveBeenCalledWith('running');
});
it('observes a running preview ending instead of treating its old listening port as current success',async()=>{
  mock.listening=true;const cb=callbacks(),handle=realPreviews.start(job(),cb);await vi.waitFor(()=>expect(cb.status).toHaveBeenCalledWith('running'));mock.listening=false;active!.finish(0);
  await vi.waitFor(()=>expect(cb.failed).toHaveBeenCalledWith('The app stopped (exit code 0).'));await handle.stop();
});
