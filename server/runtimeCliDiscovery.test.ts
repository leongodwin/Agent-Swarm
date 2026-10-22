import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const exec=vi.hoisted(()=>({run:vi.fn()}));vi.mock('./exec.ts',()=>exec);
import {resolveCommand,commandFor,detectClis,unwrapCmdShim,codexThread,cliLabel,isCli,trustKey,launchArgs,type LaunchContext} from './clis.ts';
let root='';
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'cf-runtime-discovery-'));exec.run.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true,maxRetries:10});});
function executable(name:string,content='synthetic'){const file=path.join(root,name+(process.platform==='win32'?'.cmd':''));fs.writeFileSync(file,content,{mode:0o755});return file;}
function fixturePath(){const key=Object.keys(process.env).find(key=>key.toUpperCase()==='PATH')??'PATH';vi.stubEnv(key,root);vi.stubEnv('PATHEXT','.CMD;.JS;.PS1;.EXE');}
const context:LaunchContext={prompt:'Synthetic',systemAppend:'Guidance',model:'',effort:'',sessionId:'session',name:'fixture',role:'dev',additionalDirectories:[],files:{settings:path.join(os.tmpdir(),'settings.json'),mcp:null,system:path.join(os.tmpdir(),'instructions.md')},notify:{script:'notify.cjs',url:'http://127.0.0.1:0/hooks'},codexHook:'hook.cjs',plugin:'file:///synthetic.mjs',browser:null};

it('resolves only ordinary permitted executable files from the supplied PATH',()=>{
  const allowed=executable('fixture');fs.mkdirSync(path.join(root,process.platform==='win32'?'directory.cmd':'directory'));expect(resolveCommand('fixture',{Path:root,PATHEXT:'.JS;.CMD'})).toBe(allowed);expect(resolveCommand('directory',{PATH:root,PATHEXT:'.CMD'})).toBeNull();expect(resolveCommand('missing',{PATH:root,PATHEXT:'.CMD'})).toBeNull();expect(resolveCommand('fixture',{})).toBeNull();
  if(process.platform==='win32'){fs.writeFileSync(path.join(root,'untrusted.ps1'),'fixture');expect(resolveCommand('untrusted',{PATH:root,PATHEXT:'.PS1;.JS'})).toBeNull();}else{fs.chmodSync(allowed,0o600);expect(resolveCommand('fixture',{PATH:root})).toBeNull();}
});
it('uses the supplied PATH search order and skips missing directories',()=>{
  const file=executable('fixture');expect(resolveCommand('fixture',{PATH:[path.join(root,'missing'),root].join(path.delimiter),PATHEXT:'.CMD'})).toBe(file);expect(resolveCommand('fixture',{PATH:'',PATHEXT:''})).toBeNull();
});
it('keeps forbidden and unavailable runtimes absent without launching discovery commands',()=>{
  fixturePath();for(const runtime of ['claude','copilot'] as const)expect(commandFor(runtime)).toBeNull();expect(commandFor('codex')).toBeNull();expect(isCli('claude')).toBe(false);expect(isCli('gemini')).toBe(true);expect(cliLabel('codex')).toBe('Codex');expect(cliLabel('claude')).toBe('claude');expect(exec.run).not.toHaveBeenCalled();
});
it('runs only mocked read-only version commands and preserves missing versus unknown versions',async()=>{
  fixturePath();executable('codex');executable('gemini');exec.run.mockResolvedValueOnce('codex synthetic\nmore output').mockRejectedValueOnce(new Error('synthetic version unavailable'));const result=await detectClis();expect(result).toEqual([{id:'codex',label:'Codex',installed:true,version:'codex synthetic',integrated:false},{id:'opencode',label:'OpenCode',installed:false,version:null,integrated:false},{id:'gemini',label:'Gemini',installed:true,version:null,integrated:false}]);expect(exec.run).toHaveBeenCalledTimes(2);for(const [,args,options] of exec.run.mock.calls){expect(args).toEqual(['--version']);expect(options).toEqual({timeoutMs:20000});}
});
it('bounds version display and treats an empty version response as unknown',async()=>{
  fixturePath();executable('codex');executable('opencode');exec.run.mockResolvedValueOnce('v'.repeat(100)).mockResolvedValueOnce(' \r\n');const result=await detectClis();expect(result[0].version).toHaveLength(60);expect(result[1]).toMatchObject({installed:true,version:null});
});
it('unwraps only known node shims and prefers the bundled Node executable when it exists',()=>{
  fs.writeFileSync(path.join(root,'node.exe'),'fixture');const shim=path.join(root,'codex.cmd');expect(unwrapCmdShim(shim,'"%dp0%\\node_modules\\synthetic\\cli.cjs" %*')).toEqual({file:path.join(root,'node.exe'),args:[path.join(root,'node_modules\\synthetic\\cli.cjs')]});expect(unwrapCmdShim(shim,'"%dp0%\\script.ps1" %*')).toBeNull();expect(unwrapCmdShim(shim,'echo hello %*')).toBeNull();expect(unwrapCmdShim(shim,'"%dp0%\\script.js" without-forwarding')).toBeNull();
});
it.skipIf(process.platform!=='win32')('uses a discovered shim directly when its bytes cannot be read or interpreted',()=>{
  fixturePath();const file=executable('codex','@echo unsupported');expect(commandFor('codex')).toEqual({file,args:[]});const original=fs.readFileSync;vi.spyOn(fs,'readFileSync').mockImplementation(((...args:Parameters<typeof fs.readFileSync>)=>{if(String(args[0])===file)throw new Error('synthetic read denied');return original(...args);}) as typeof fs.readFileSync);expect(commandFor('codex')).toEqual({file,args:[]});
});
it('archives and unarchives a saved thread in order after prerequisite cleanup, without invoking real commands',async()=>{
  fixturePath();executable('codex');let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});exec.run.mockResolvedValue('');const first=codexThread('archive','synthetic-thread',gate),second=codexThread('unarchive','synthetic-thread');await Promise.resolve();expect(exec.run).not.toHaveBeenCalled();release();await Promise.all([first,second]);expect(exec.run.mock.calls.map(([,args])=>args)).toEqual([['archive','synthetic-thread'],['unarchive','synthetic-thread']]);expect(exec.run.mock.calls[0][2]).toEqual({timeoutMs:30000});
});
it('does not run thread commands when cleanup rejects or the CLI is absent and permits later work after failure',async()=>{
  fixturePath();await codexThread('archive','missing');expect(exec.run).not.toHaveBeenCalled();executable('codex');exec.run.mockRejectedValueOnce(new Error('synthetic unavailable')).mockResolvedValueOnce('');await codexThread('archive','recoverable');await codexThread('unarchive','recoverable');expect(exec.run).toHaveBeenCalledTimes(2);await codexThread('archive','cleanup-rejected',Promise.reject(new Error('synthetic cleanup failed')));expect(exec.run).toHaveBeenCalledTimes(2);
});
it('never guesses a trust answer when the selected text is absent or unknown',()=>{expect(trustKey('Do you trust the contents of this directory?')).toBeNull();expect(trustKey('Do you trust the contents of this directory?\n› Learn more')).toBeNull();expect(trustKey('Do you trust the contents of this directory?\n› Proceed')).toBe('enter');});
it('keeps OpenCode provider policy and optional MCP configuration exact for a resumed task',()=>{
  const launch=launchArgs('opencode',{...context,model:'google/gemini-synthetic',resumeId:'retained-session',browser:{command:'synthetic-browser',args:['--readonly']},officeUrl:'http://127.0.0.1:0/mcp'}),config=JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT);expect(launch.args).toContain('--session');expect(launch.env.CUBEFARM_OPENCODE_SESSION_ID).toBe('retained-session');expect(config).toMatchObject({enabled_providers:['openai','google'],model:'google/gemini-synthetic',small_model:'google/gemini-synthetic',autoupdate:false,mcp:{playwright:{type:'local',command:['synthetic-browser','--readonly']},office:{type:'remote',url:'http://127.0.0.1:0/mcp'}}});
});
it('launches Gemini with a protected profile and optional office context while withholding task arguments',()=>{
  const launch=launchArgs('gemini',{...context,model:'gemini-synthetic',resumeId:'retained',officeUrl:'http://127.0.0.1:0/mcp'});expect(launch.args).toEqual(['--model','gemini-synthetic','--resume','retained']);expect(launch.args).not.toContain(context.prompt);expect(launch.env).toMatchObject({CUBEFARM_OFFICE_URL:'http://127.0.0.1:0/mcp',CUBEFARM_HOOK_URL:context.notify.url});expect(launch.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toMatch(/gemini/i);
});
