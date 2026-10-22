import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {workerMcpBindings,resolveWorkerMcp,bindWorkerMcpTargets,canvasProbeObservation,type WorkerMcpBinding} from './workerMcp.ts';
import {WorkerPreflight,workerPreflightSchema,type WorkerPreflightPlan} from './workerPreflight.ts';
import {launchArgs,type LaunchContext} from './clis.ts';
import type {InstalledSkill} from './skillRegistry.ts';
const roots:string[]=[];afterEach(()=>{roots.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true}));vi.unstubAllEnvs();});
const hash=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
function fixture(flow=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-mcp-'));roots.push(root);
 vi.stubEnv('SWARM_HOME',root);const sdk=path.join(root,'tools','dotnet');fs.mkdirSync(path.join(sdk,'sdk','10.0.100'),{recursive:true});fs.writeFileSync(path.join(sdk,process.platform==='win32'?'dotnet.exe':'dotnet'),'Synthetic native host');fs.writeFileSync(path.join(sdk,'sdk','10.0.100','dotnet.dll'),'Synthetic SDK');
 const plugin=path.join(root,flow?'power-automate':'canvas-apps','1.0.0'),folder=path.join(plugin,'skills',flow?'build-flow':'canvas-app');fs.mkdirSync(folder,{recursive:true});
 const text='Pinned test guidance; use actual native contracts.';const file=path.join(folder,'SKILL.md');fs.writeFileSync(file,text);
 const config=path.join(plugin,'.mcp.json');fs.writeFileSync(config,JSON.stringify({mcpServers:flow?{flowagent:{command:'node',args:['-e','untrusted inline launch must not be executed']}}:{'canvas-authoring':{command:'dnx',args:['Microsoft.PowerApps.CanvasAuthoring.McpServer','--yes']}}}));
 if(flow){fs.mkdirSync(path.join(plugin,'server'));fs.writeFileSync(path.join(plugin,'server','mcp.mjs'),'// Native test entry');}
 const skill:InstalledSkill={id:flow?'power-automate:build-flow':'canvas-apps:canvas-app',name:flow?'build-flow':'canvas-app',platform:flow?'power-automate':'canvas',file,source:'plugin',activation:'configured',version:'1.0.0',sha256:hash(text),description:'test',toolStatus:'unverified'};
 const proposed=workerMcpBindings([skill])[0];if(proposed.status==='unavailable')throw Error('Missing test binding');const {status:_,...binding}=proposed;
 return {root,plugin,skill,config,binding:binding as WorkerMcpBinding};
}
const reply=(text:string)=>({content:[{type:'text',text}]});
const flowTarget='Default-11111111-1111-4111-8111-111111111111';
const targetProbe=(target:unknown)=>({tool:'mcp__flowagent__whoami',input:{},assertions:[{kind:'target',pointer:['currentEnv'],equals:target}]});
it('pins only the FlowAgent child environment to its reviewed native target without changing global state',()=>{
 const f=fixture(true),servers=resolveWorkerMcp([f.binding],[f.skill]),before=process.env.PA_DEFAULT_ENVIRONMENT;
 const pinned=bindWorkerMcpTargets(servers,[targetProbe(flowTarget)]);
 expect(pinned.flowagent.env).toEqual({PA_DEFAULT_ENVIRONMENT:flowTarget});expect(servers.flowagent.env).toBeUndefined();expect(process.env.PA_DEFAULT_ENVIRONMENT).toBe(before);
 expect(bindWorkerMcpTargets({},[targetProbe(flowTarget)])).toEqual({});
 expect(bindWorkerMcpTargets(servers,[{...targetProbe(flowTarget),tool:'mcp__other__whoami'}])).toBe(servers);
});
it.each(['https://wrong.example.test','Default-wrong',false])('refuses invalid reviewed FlowAgent environment %j before launch',target=>{
 const f=fixture(true);expect(()=>bindWorkerMcpTargets(resolveWorkerMcp([f.binding],[f.skill]),[targetProbe(target)])).toThrow('one exact reviewed environment');
});
it('refuses contradictory FlowAgent targets and does not treat configured context as a successful observation',()=>{
 const f=fixture(true),servers=resolveWorkerMcp([f.binding],[f.skill]);expect(()=>bindWorkerMcpTargets(servers,[targetProbe(flowTarget),targetProbe('22222222-2222-4222-8222-222222222222')])).toThrow();
 const plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Synthetic target pin',maxAgeSeconds:60,skills:[{id:f.skill.id,sha256:f.skill.sha256}],mcpServers:[f.binding],probes:[{...targetProbe(flowTarget),id:'flow',readOnly:true,assertions:[{kind:'identity',pointer:['caller'],equals:'maker'},{kind:'target',pointer:['currentEnv'],equals:flowTarget}]}]};
 fs.mkdirSync(path.join(f.root,'.cubefarm'));fs.writeFileSync(path.join(f.root,'.cubefarm','worker-preflight.json'),JSON.stringify(plan));const gate=new WorkerPreflight(f.root,()=>({fingerprint:'test',warnings:[],skills:[f.skill]}));
 expect(gate.runtimeServers().flowagent.env).toEqual({PA_DEFAULT_ENVIRONMENT:flowTarget});expect(gate.observed().ready).toBe(false);
 gate.before('skill','mcp__office__read_skill',plan.skills[0]);gate.after('skill',reply(JSON.stringify({...plan.skills[0],content:fs.readFileSync(f.skill.file,'utf8')})),false);
 gate.before('wrong','mcp__flowagent__whoami',{});gate.after('wrong',reply(JSON.stringify({caller:'maker',currentEnv:null})),false);expect(gate.observed().probeIds).toEqual([]);
 gate.before('right','mcp__flowagent__whoami',{});gate.after('right',reply(JSON.stringify({caller:'maker',currentEnv:flowTarget})),false);expect(gate.observed().ready).toBe(true);
});
function discoveryFixture(){
 const f=fixture(true),file=path.join(f.root,'docs','worker-preflight.candidate.json');fs.mkdirSync(path.dirname(file));
 const plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Synthetic candidate only',maxAgeSeconds:60,skills:[{id:f.skill.id,sha256:f.skill.sha256}],mcpServers:[f.binding],probes:[{id:'unreviewed',tool:'mcp__flowagent__create_flow',readOnly:true,input:{},assertions:[{kind:'identity',pointer:['caller'],equals:'maker'},{kind:'target',pointer:['env'],equals:'test'}]}]};
 fs.writeFileSync(file,JSON.stringify(plan));return {...f,file,plan,catalogue:{fingerprint:'test',warnings:[],skills:[f.skill]}};
}
it.each(['discovery','design'] as const)('exposes configured canonical schemas in %s without importing unreviewed calls or authoring authority',mode=>{
 const f=discoveryFixture(),gate=new WorkerPreflight(f.root,()=>f.catalogue,undefined,'codex',mode);
 expect(gate.runtimeServers()).toHaveProperty('flowagent');expect(gate.instructions()).toContain('tool-schema inspection only');
 expect(gate.before('schema-search','ToolSearch',{query:'flowagent whoami'})).toBeNull();
 gate.before('skill','mcp__office__read_skill',f.plan.skills[0]);gate.after('skill',reply(JSON.stringify({...f.plan.skills[0],content:fs.readFileSync(f.skill.file,'utf8')})),false);
 expect(gate.blocker()).toBeNull();expect(gate.observed().ready).toBe(false);
 for(const tool of ['mcp__flowagent__create_flow','mcp__flowagent__whoami','Bash','Edit','mcp__office__approve_release'])expect(gate.before(tool,tool,{})).toContain('Read-only discovery');
 gate.after('mcp__flowagent__create_flow',reply('{"caller":"maker","env":"test"}'),false);expect(gate.observed().probeIds).toEqual([]);
 expect(new WorkerPreflight(f.root,()=>f.catalogue).configurationBlocker()).toContain('missing or invalid');
 expect(new WorkerPreflight(f.root,()=>f.catalogue,undefined,'gemini',mode).configurationBlocker()).toContain('protected profile');
 fs.appendFileSync(f.file,' ');expect(gate.configurationBlocker()).toContain('cannot be verified');
});
it.each(['malformed','oversized','unconfirmed','runtime-drift'] as const)('refuses %s discovery metadata before native launch',mode=>{
 const f=discoveryFixture();
 if(mode==='malformed')fs.writeFileSync(f.file,'{');if(mode==='oversized')fs.writeFileSync(f.file,' '.repeat(32769));
 if(mode==='unconfirmed')f.skill.activation='unconfirmed';if(mode==='runtime-drift')fs.appendFileSync(f.config,' ');
 const gate=new WorkerPreflight(f.root,()=>f.catalogue,undefined,'codex','discovery');expect(gate.configurationBlocker()).toContain('discovery candidate');expect(()=>gate.runtimeServers()).toThrow();
});
it('resolves only reviewed plugin artifacts and prevents configuration drift',()=>{
 const f=fixture(),servers=resolveWorkerMcp([f.binding],[f.skill]);expect(servers.canvas_authoring.args.slice(0,3)).toEqual(['exec',path.join(f.root,'tools','dotnet','sdk','10.0.100','dotnet.dll'),'dnx']);
 fs.writeFileSync(f.config,'{}');expect(()=>resolveWorkerMcp([f.binding],[f.skill])).toThrow('changed');
});
it('revokes a reviewed Canvas runtime when its managed SDK changes',()=>{
 const f=fixture();const server=resolveWorkerMcp([f.binding],[f.skill]).canvas_authoring;
 fs.appendFileSync(server.args[1],'Changed SDK');expect(()=>resolveWorkerMcp([f.binding],[f.skill])).toThrow('changed');
});
it('uses the pinned absolute FlowAgent entry rather than cwd or inline shell code',()=>{
 const f=fixture(true),server=resolveWorkerMcp([f.binding],[f.skill]).flowagent;
 expect(server.args).toEqual([path.join(f.plugin,'server','mcp.mjs')]);expect(server.cwd).toBeUndefined();
 fs.appendFileSync(server.args[0],'changed');expect(()=>resolveWorkerMcp([f.binding],[f.skill])).toThrow('changed');
});
it('supports the real bundled FlowAgent size while bounding executable artifacts',()=>{
 const f=fixture(true),entry=path.join(f.plugin,'server','mcp.mjs');fs.writeFileSync(entry,Buffer.alloc(3*1024*1024,32));
 const proposed=workerMcpBindings([f.skill])[0];expect(proposed.status).not.toBe('unavailable');
 if(proposed.status==='unavailable')throw Error('Native-sized bundle unavailable');const {status:_,...binding}=proposed;
 expect(resolveWorkerMcp([binding],[f.skill]).flowagent.args).toEqual([entry]);
 fs.truncateSync(entry,16*1024*1024+1);expect(workerMcpBindings([f.skill])[0].status).toBe('unavailable');
});
it('rejects an unpinned skill, duplicate server or wrong server family',()=>{
 const f=fixture();expect(()=>resolveWorkerMcp([f.binding],[])).toThrow('pinned');expect(()=>resolveWorkerMcp([f.binding,f.binding],[f.skill])).toThrow('Duplicate');
 expect(()=>resolveWorkerMcp([{...f.binding,server:'flowagent'}],[f.skill])).toThrow('changed');
});
it('normalizes exact saved-app native prose and refuses lookalike/error replies',()=>{
 const text='Successfully connected for app: 12345678-1234-1234-1234-123456789abc, environment Default-test. Signed in as: maker@example.test.';
 expect(canvasProbeObservation('mcp__canvas_authoring__connect',reply(text))).toMatchObject({appId:'12345678-1234-1234-1234-123456789abc',environmentId:'default-test',username:'maker@example.test',connected:true});
 for(const raw of [reply('Successfully connected'),reply('prefix '+text),reply(text.replace('12345678-1234-1234-1234-123456789abc','------------------------------------')),{...reply(text),isError:true},{...reply(text),error:'denied'},{...reply(text),structuredContent:{error:'denied'}},{content:[{type:'text',text},{type:'text',text:'truncated'}]}])expect(canvasProbeObservation('mcp__canvas_authoring__connect',raw)).toBeNull();
 expect(canvasProbeObservation('mcp__canvas_authoring__list_accounts',reply('Signed-in accounts:\n- maker@example.test (connected)'))).toMatchObject({username:'maker@example.test'});
 expect(canvasProbeObservation('mcp__canvas_authoring__list_accounts',reply('Signed-in accounts:\n- a@example.test (connected)\n- b@example.test (connected)'))).toBeNull();
 expect(canvasProbeObservation('mcp__canvas_authoring__list_accounts',reply('Authentication failed\n- maker@example.test (connected)'))).toBeNull();
});
it('normal worker preflight admits native operations only after pinned skill and matching real-contract observations',()=>{
 const f=fixture(),catalogue={fingerprint:'test',warnings:[],skills:[f.skill]};
 const plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Dedicated test app only',maxAgeSeconds:60,skills:[{id:f.skill.id,sha256:f.skill.sha256}],mcpServers:[f.binding],probes:[{id:'canvas-session',tool:'mcp__canvas_authoring__connect',nativeNames:{opencode:'canvas_authoring_connect'},readOnly:true,input:{app_id:'12345678-1234-1234-1234-123456789abc',environment_id:'default-test'},assertions:[{kind:'identity',pointer:['username'],equals:'maker@example.test'},{kind:'target',pointer:['appId'],equals:'12345678-1234-1234-1234-123456789abc'}]}]};
 fs.mkdirSync(path.join(f.root,'.cubefarm'));fs.writeFileSync(path.join(f.root,'.cubefarm','worker-preflight.json'),JSON.stringify(plan));
 const gate=new WorkerPreflight(f.root,()=>catalogue,undefined,'opencode');expect(gate.runtimeServers()).toHaveProperty('canvas_authoring');
 expect(gate.before('compile','mcp__canvas_authoring__compile_canvas',{})).toContain('Read every pinned');
 gate.before('skill','mcp__office__read_skill',plan.skills[0]);gate.after('skill',reply(JSON.stringify({...plan.skills[0],content:fs.readFileSync(f.skill.file,'utf8')})),false);
 expect(gate.blocker()).toContain('exact reviewed');
 gate.before('connect','canvas_authoring_connect',plan.probes[0].input);gate.after('connect',reply('Successfully connected for app: 12345678-1234-1234-1234-123456789abc, environment default-test. Signed in as: maker@example.test.'),false);
 expect(gate.blocker()).toBeNull();expect(gate.before('compile2','mcp__canvas_authoring__compile_canvas',{})).toBeNull();
 expect(gate.inspection()).toMatchObject({nativeChecksSatisfied:true,authoringAuthorityGranted:false,probes:[{proof:{callId:'connect',adapter:'canvas-native-text-v1'},assertions:[{matched:true},{matched:true}]}]});
 gate.before('failed-refresh','canvas_authoring_connect',plan.probes[0].input);gate.after('failed-refresh',reply(JSON.stringify({username:'maker@example.test',appId:'12345678-1234-1234-1234-123456789abc',success:false})),false);
 expect(gate.blocker()).toContain('unverified');
 const gemini=new WorkerPreflight(f.root,()=>catalogue,undefined,'gemini');expect(gemini.configurationBlocker()).toContain('protected profile');expect(()=>gemini.runtimeServers()).toThrow('protected profile');
 fs.appendFileSync(f.config,' ');expect(gate.blocker()).toContain('cannot be verified');
});
it('requires each attached server to have a pinned skill and native probe',()=>{
 const f=fixture();const p={schemaVersion:1,mode:'discovery',scope:'test',maxAgeSeconds:60,skills:[],noSkillsReason:'No guidance is available in this test fixture',probes:[],mcpServers:[f.binding]};expect(workerPreflightSchema.safeParse(p).success).toBe(false);
});
it.each((['discovery','design'] as const).flatMap(mode=>(['codex','opencode'] as const).map(runtime=>({mode,runtime}))))('permits fresh target-bound Canvas source capture in $mode/$runtime without authoring',({mode,runtime})=>{
 const f=fixture(),directory=path.join(f.root,'captured-source'),plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Dedicated source discovery',maxAgeSeconds:60,skills:[{id:f.skill.id,sha256:f.skill.sha256}],mcpServers:[f.binding],probes:[{id:'canvas',tool:'mcp__canvas_authoring__connect',readOnly:true,input:{app_id:'12345678-1234-1234-1234-123456789abc',environment_id:'default-test'},assertions:[{kind:'identity',pointer:['username'],equals:'maker@example.test'},{kind:'target',pointer:['appId'],equals:'12345678-1234-1234-1234-123456789abc'}]}]};
 fs.mkdirSync(path.join(f.root,'.cubefarm'));fs.writeFileSync(path.join(f.root,'.cubefarm','worker-preflight.json'),JSON.stringify(plan));let now=Date.now();
 plan.probes[0].nativeNames={opencode:'canvas_authoring_connect'};fs.writeFileSync(path.join(f.root,'.cubefarm','worker-preflight.json'),JSON.stringify(plan));
 const gate=new WorkerPreflight(f.root,()=>({fingerprint:'test',warnings:[],skills:[f.skill]}),()=>now,runtime,mode,directory);
 const native=(name:string)=>runtime==='opencode'?name.replace('mcp__canvas_authoring__','canvas_authoring_'):name;
 expect(gate.before('no-probe','mcp__canvas_authoring__list_data_sources',{})).toContain('Read-only');
 gate.before('skill','mcp__office__read_skill',plan.skills[0]);gate.after('skill',reply(JSON.stringify({...plan.skills[0],content:fs.readFileSync(f.skill.file,'utf8')})),false);
 gate.before('connect',native(plan.probes[0].tool),plan.probes[0].input);gate.after('connect',reply('Successfully connected for app: 12345678-1234-1234-1234-123456789abc, environment default-test. Signed in as: maker@example.test.'),false);
 expect(gate.before('list',native('mcp__canvas_authoring__list_data_sources'),{})).toBeNull();expect(gate.before('schema',native('mcp__canvas_authoring__get_data_source_schema'),{dataSourceName:'Requests'})).toBeNull();
 expect(gate.before('sync',native('mcp__canvas_authoring__sync_canvas'),{directoryPath:directory})).toBeNull();
 expect(gate.before('outside','mcp__canvas_authoring__sync_canvas',{directoryPath:path.join(f.root,'other')})).toContain('Read-only');
 fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'App.pa.yaml'),'retained source');gate.after('sync',reply(`Synced 1 file(s) to ${directory}`),false);
 expect(gate.inspection().sourceCapture).toMatchObject({status:'captured-source-files',adapter:'canvas-native-source-sync-v1',callId:'sync',files:[{file:'App.pa.yaml',content:'retained source'}]});
 fs.writeFileSync(path.join(directory,'App.pa.yaml'),'later local change');expect(gate.inspection().sourceCapture).toMatchObject({files:[{content:'retained source'}]});
 expect(gate.before('overwrite','mcp__canvas_authoring__sync_canvas',{directoryPath:directory})).toContain('Read-only');
 expect(gate.before('compile','mcp__canvas_authoring__compile_canvas',{directoryPath:directory})).toContain('Read-only');
 expect(gate.before('other-app','mcp__canvas_authoring__connect',{...plan.probes[0].input,app_id:'other'})).toContain('Read-only');
 now+=60000;expect(gate.before('expired','mcp__canvas_authoring__list_data_sources',{})).toContain('Read-only');
 expect(gate.observed().ready).toBe(false);
});
it.each(['codex','opencode'] as const)('carries platform MCPs into the real %s launch format',cli=>{
 const f=fixture(true),servers=bindWorkerMcpTargets(resolveWorkerMcp([f.binding],[f.skill]),[targetProbe(flowTarget)]);const ctx:LaunchContext={prompt:'Build the dedicated test app',systemAppend:'test',model:cli==='opencode'?'openai/gpt-5.4':'',effort:'',sessionId:'test',name:'test',role:'dev',additionalDirectories:[],files:{settings:'settings.json',mcp:null,system:'instructions.md'},notify:{script:'notify.cjs',url:'http://127.0.0.1/hooks/test'},codexHook:'hook.cjs',plugin:'plugin.mjs',browser:null,platformServers:servers};
 const launch=launchArgs(cli,ctx);
 if(cli==='codex'){
  expect(launch.args.some(a=>a.startsWith('mcp_servers.flowagent=')&&a.includes('mcp.mjs'))).toBe(true);
  expect(launch.args.some(a=>a.startsWith('mcp_servers.flowagent=')&&a.includes(`env={"PA_DEFAULT_ENVIRONMENT"="${flowTarget}"}`))).toBe(true);
  for(const alias of ['swarm-flowagent','swarm_flowagent'])expect(launch.args.some(a=>a.startsWith(`mcp_servers.${alias}={`)&&a.includes('command=')&&a.includes('enabled=false'))).toBe(true);
 }
 else {const config=JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT);expect(config.mcp.flowagent.command).toEqual([process.execPath,path.join(f.plugin,'server','mcp.mjs')]);expect(config.mcp.flowagent.environment).toEqual({PA_DEFAULT_ENVIRONMENT:flowTarget});}
});
