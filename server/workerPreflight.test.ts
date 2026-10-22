import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {WorkerPreflight,workerPreflightSchema,type WorkerPreflightPlan} from './workerPreflight.ts';
import type {SkillCatalogue} from './skillRegistry.ts';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-preflight-'));roots.push(root);
  const content='Synthetic instructions: inspect the target before authoring.';
  const sha256=crypto.createHash('sha256').update(content).digest('hex');
  const skillFile=path.join(root,'SKILL.md');fs.writeFileSync(skillFile,content);
  const catalogue:SkillCatalogue={fingerprint:'synthetic',warnings:[],skills:[{id:'dataverse:dv-solution',name:'dv-solution',description:'Synthetic instructions',platform:'dataverse',file:skillFile,source:'shared',sha256,toolStatus:'unverified'}]};
  const plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Synthetic development only',maxAgeSeconds:60,skills:[{id:'dataverse:dv-solution',sha256}],probes:[{id:'identity-target',tool:'mcp__platform__inspect',readOnly:true,input:{scope:'development'},assertions:[{kind:'identity',pointer:['caller'],equals:'test-maker'},{kind:'target',pointer:['environment'],equals:'test-environment'},{kind:'access',pointer:['canRead'],equals:true}]}]};
  const file=path.join(root,'.cubefarm','worker-preflight.json');fs.mkdirSync(path.dirname(file));
  const save=()=>fs.writeFileSync(file,JSON.stringify(plan));save();let now=1000;
  const gate=new WorkerPreflight(root,()=>catalogue,()=>now);
  const read=()=>{expect(gate.before('read','mcp__office__read_skill',plan.skills[0])).toBeNull();gate.after('read',{content:[{type:'text',text:JSON.stringify({...plan.skills[0],content})}]},false);};
  const probe=(result:unknown={caller:'test-maker',environment:'test-environment',canRead:true},failed=false)=>{expect(gate.before('probe',plan.probes[0].tool,plan.probes[0].input)).toBeNull();gate.after('probe',result,failed);};
  return {root,file,skillFile,content,plan,catalogue,gate,save,read,probe,advance:(ms:number)=>{now+=ms;}};
}
it('provides a bounded preflight bootstrap before shell or memory commands without granting authoring',()=>{
 const f=fixture(),instructions=f.gate.instructions();expect(instructions).toContain('Complete these before shell or memory commands');expect(instructions).toContain('"file":".cubefarm/worker-preflight.json"');expect(instructions).toContain('maxLines must be <=120');expect(instructions).toContain('Reviewed preflight inputs');
 expect(f.gate.before('source','mcp__office__read_delivery_source',{request_json:JSON.stringify({kind:'repository-file',file:'.cubefarm/worker-preflight.json',startLine:1,maxLines:120})})).toBeNull();expect(f.gate.before('shell','Bash',{command:'Get-Content .cubefarm/worker-preflight.json'})).toBeTruthy();expect(f.gate.before('edit','Write',{file_path:'app.yaml',content:'Synthetic'})).toBeTruthy();
});
it('records exact native connection-array proofs and revokes them after a failed refresh or expiry',()=>{const f=fixture();f.plan.probes.push({id:'owner-connection',tool:'mcp__flowagent__list_connections',readOnly:true,input:{env:'approved',connector:'shared_office365'},assertions:[{kind:'access',pointer:['0','status'],equals:'Connected'},{kind:'identity',pointer:['0','accountName'],equals:'owner@example.test'}]});f.save();let now=1000;const gate=new WorkerPreflight(f.root,()=>f.catalogue,()=>now);gate.before('skill','mcp__office__read_skill',f.plan.skills[0]);gate.after('skill',{...f.plan.skills[0],content:f.content},false);const base=f.plan.probes[0],probe=f.plan.probes[1],result={content:[{type:'text',text:JSON.stringify([{name:'pinned',connector:'/providers/Microsoft.PowerApps/apis/shared_office365',status:'Connected',accountName:'owner@example.test'}])}]};gate.before('identity',base.tool,base.input);gate.after('identity',{caller:'test-maker',environment:'test-environment',canRead:true},false);gate.before('connections',probe.tool,probe.input);gate.after('connections',result,false);expect(gate.inspection().nativeChecksSatisfied).toBe(true);expect(gate.inspection().probes[1].proof?.adapter).toBe('flow-native-connection-array-v1');gate.before('failed',probe.tool,probe.input);gate.after('failed',{isError:true,structuredContent:[]},false);expect(gate.inspection().nativeChecksSatisfied).toBe(false);gate.before('wrong-shape',probe.tool,probe.input);gate.after('wrong-shape',{'0':{status:'Connected',accountName:'owner@example.test'}},false);expect(gate.inspection().nativeChecksSatisfied).toBe(false);gate.before('refreshed',probe.tool,probe.input);gate.after('refreshed',result,false);expect(gate.inspection().nativeChecksSatisfied).toBe(true);now+=60000;expect(gate.inspection().nativeChecksSatisfied).toBe(false);});
it('exposes the current capture path and rejects retained-conversation source before fresh correlated capture',()=>{
 const f=fixture(),old=path.join(f.root,'old-source'),current=path.join(f.root,'current-source');for(const d of [old,current]){fs.mkdirSync(d);fs.writeFileSync(path.join(d,'App.pa.yaml'),'App: {}');}
 const gate=new WorkerPreflight(f.root,()=>f.catalogue,()=>1000,'codex','authoring',current);
 expect(gate.inspection().sourceCaptureDirectory).toBe(current);
 expect(gate.before('skill','mcp__office__read_skill',f.plan.skills[0])).toBeNull();gate.after('skill',{content:[{type:'text',text:JSON.stringify({...f.plan.skills[0],content:f.content})}]},false);
 expect(gate.before('probe',f.plan.probes[0].tool,f.plan.probes[0].input)).toBeNull();gate.after('probe',{caller:'test-maker',environment:'test-environment',canRead:true},false);
 const native=(d:string)=>({content:[{type:'text',text:`Synced 1 file(s) to ${d}`}]});
 expect(gate.before('old','mcp__canvas_authoring__sync_canvas',{directoryPath:old})).toBeNull();gate.after('old',native(old),false);
 expect(gate.inspection().sourceCapture).toMatchObject({status:'unavailable',reason:expect.stringContaining('different session directory')});
 // An old/uncorrelated completion cannot import previously synced files.
 gate.after('old',native(current),false);expect(gate.inspection().sourceCapture?.status).toBe('unavailable');
 expect(gate.before('fresh','mcp__canvas_authoring__sync_canvas',{directoryPath:current})).toBeNull();gate.after('fresh',native(current),false);
 const capture=gate.inspection().sourceCapture;expect(capture).toMatchObject({status:'captured-source-files',callId:'fresh',files:[{file:'App.pa.yaml',content:'App: {}'}]});
 fs.writeFileSync(path.join(current,'App.pa.yaml'),'App: {changed: true}');expect(gate.inspection().sourceCapture).toEqual(capture);
 const successor=new WorkerPreflight(f.root,()=>f.catalogue,()=>1000,'codex','authoring',path.join(f.root,'successor'));expect(successor.inspection().sourceCapture).toBeNull();expect(successor.inspection().sourceCaptureDirectory).not.toBe(current);
});
it('blocks coding and approval until exact skill contents and session-local identity/target/access probes pass',()=>{
  const f=fixture();expect(f.gate.before('edit','Edit',{file_path:'app.ts',new_string:'code'})).toContain('Read every');
  expect(f.gate.before('approve','mcp__office__approve_release',{})).toContain('Read every');
  f.read();expect(f.gate.blocker()).toContain('unverified');f.probe();expect(f.gate.blocker()).toBeNull();
  expect(f.gate.before('edit','Edit',{file_path:'app.ts',new_string:'code'})).toBeNull();
});
it('directs workers to the verified-list schema broker without treating metadata as write permission',()=>{
 const f=fixture(),instructions=f.gate.instructions();
 expect(instructions).toContain('{kind:"sharepoint-list-schema",resourceKey:"exact planned key"}');
 expect(instructions).toContain('Generic resolve_params descriptors or failed dynamic calls are not resolved schema');
 expect(instructions).toContain('Do not re-provision the list or infer write permission');
 expect(instructions).toContain('Use top:50 at most (or omit it), never top:100');
 expect(instructions).toContain('does not prove complete inventory');
 expect(f.gate.observed().ready).toBe(false);
 expect(f.gate.before('write','Edit',{})).toContain('Read every');
});
it.each(['discovery','design','authoring'] as const)('allows only bounded evidence-index diagnostics with incomplete %s preflight',mode=>{
 const f=fixture();f.plan.mode=mode==='design'?'discovery':mode;f.save();if(mode==='authoring')fs.writeFileSync(f.file,'{invalid');const gate=new WorkerPreflight(f.root,()=>f.catalogue,()=>1000,'codex',mode);
 expect(gate.blocker()).toBeTruthy();const input={action:'evidence_index',repo_id:'synthetic/repo',payload_json:'{"startIndex":0,"maxEntries":20}'};
 expect(gate.before('index','mcp__office__delivery_record',input)).toBeNull();gate.after('index',{content:[{type:'text',text:'{"scope":"discovery-evidence-index","entries":[]}'}]},false);expect(gate.blocker()).toBeTruthy();expect(gate.observed().ready).toBe(false);
 for(const action of ['save','review','accept_slice'])expect(gate.before(action,'mcp__office__delivery_record',{action})).toBeTruthy();
 expect(gate.before('shell','Bash',{command:'echo unsafe'})).toBeTruthy();expect(gate.before('deploy','mcp__office__approve_release',{})).toBeTruthy();
 expect(gate.before('wrong','mcp__other__delivery_record',input)).toBeTruthy();
});
it.each([{caller:'other',environment:'test-environment',canRead:true},{caller:'test-maker',environment:'wrong',canRead:true},{caller:'test-maker',environment:'test-environment',canRead:false},'Tool exists; success',{isError:true,content:[{type:'text',text:'success'}]},{tools:[{name:'inspect'}]}])('rejects wrong identity, target, access, textual claims and tool listings: %j',result=>{
  const f=fixture();f.read();f.probe(result);expect(f.gate.blocker()).toContain('unverified');
});
it('expires observations, revokes failed refreshes and does not share readiness across resumed tasks',()=>{
  const f=fixture();f.read();f.probe();f.advance(60000);expect(f.gate.blocker()).toContain('unverified');
  f.probe();expect(f.gate.blocker()).toBeNull();f.probe({},true);expect(f.gate.blocker()).toContain('unverified');
  f.probe();expect(new WorkerPreflight(f.root,()=>f.catalogue).blocker()).toContain('Read every');
});
it('exposes evaluated assertions without raw identities or granting authoring authority',()=>{
 const f=fixture();expect(f.gate.inspection().nativeChecksSatisfied).toBe(false);f.read();f.probe();
 const receipt=f.gate.inspection();expect(receipt).toMatchObject({nativeChecksSatisfied:true,authoringAuthorityGranted:false,probes:[{matched:true,proof:{callId:'probe',adapter:'native-json-object-v1'}}]});
 expect(receipt.probes[0].assertions.every(a=>a.matched)).toBe(true);expect(JSON.stringify(receipt)).not.toContain('test-maker');expect(JSON.stringify(receipt)).not.toContain('test-environment');
 f.advance(60000);expect(f.gate.inspection().probes[0].matched).toBe(false);f.probe({},true);expect(f.gate.inspection().probes[0].proof).toBeNull();
});
it('rejects changed guidance and contract bytes after readiness',()=>{
  const f=fixture();f.read();f.probe();fs.writeFileSync(f.skillFile,'Changed guidance');expect(f.gate.blocker()).toContain('guidance changed');
  fs.writeFileSync(f.skillFile,f.content);f.plan.scope='Changed scope';f.save();expect(f.gate.blocker()).toContain('preflight changed');
});
it('does not accept fabricated, unmatched or cancelled skill/probe results',()=>{
  const f=fixture();f.gate.after('missing',{caller:'test-maker',environment:'test-environment',canRead:true},false);
  f.gate.before('skill','mcp__office__read_skill',f.plan.skills[0]);f.gate.after('skill',{...f.plan.skills[0],content:'wrong bytes'},false);expect(f.gate.blocker()).toContain('Read every');
  f.read();f.gate.before('cancel',f.plan.probes[0].tool,f.plan.probes[0].input);f.gate.cancel('cancel');f.gate.after('cancel',{caller:'test-maker',environment:'test-environment',canRead:true},false);expect(f.gate.blocker()).toContain('unverified');
  f.gate.before('mismatch',f.plan.probes[0].tool,f.plan.probes[0].input);f.gate.after('mismatch',{caller:'test-maker',environment:'test-environment',canRead:true},false,'mcp__different__tool');expect(f.gate.blocker()).toContain('unverified');
});
it('blocks arbitrary MCP and shell calls before readiness, allowing only exact reviewed probes and diagnostics',()=>{
  const f=fixture();expect(f.gate.before('shell','exec_command',{cmd:'write files'})).toBeTruthy();
  expect(f.gate.before('wrong',f.plan.probes[0].tool,{scope:'production'})).toBeTruthy();
  expect(f.gate.before('inspect','Read',{file_path:f.file})).toBeNull();
  expect(f.gate.before('same',f.plan.probes[0].tool,f.plan.probes[0].input)).toBeNull();
  expect(f.gate.before('same',f.plan.probes[0].tool,f.plan.probes[0].input)).toContain('already pending');
});
it.each(['missing','malformed','duplicate','oversized'])('fails closed on %s configuration without rewriting it',mode=>{
  const f=fixture();if(mode==='missing')fs.unlinkSync(f.file);else fs.writeFileSync(f.file,mode==='malformed'?'{':mode==='duplicate'?'{{"schemaVersion":1,"schemaVersion":1}}':' '.repeat(32769));
  const before=fs.existsSync(f.file)?fs.readFileSync(f.file,'utf8'):null;
  const gate=new WorkerPreflight(f.root,()=>f.catalogue);expect(gate.configurationBlocker()).toContain('missing or invalid');expect(gate.before('write','Edit',{})).toBeTruthy();
  expect(fs.existsSync(f.file)?fs.readFileSync(f.file,'utf8'):null).toBe(before);
});
it('rejects contracts without caller/target assertions, duplicate IDs or read-only declarations',()=>{
  const f=fixture();expect(workerPreflightSchema.safeParse({...f.plan,probes:[]}).success).toBe(false);
  expect(workerPreflightSchema.safeParse({...f.plan,skills:[],noSkillsReason:undefined}).success).toBe(false);
  expect(workerPreflightSchema.safeParse({...f.plan,probes:[{...f.plan.probes[0],readOnly:false}]}).success).toBe(false);
  expect(workerPreflightSchema.safeParse({...f.plan,skills:[...f.plan.skills,...f.plan.skills]}).success).toBe(false);
});
it('bounds pending hook correlations instead of executing unobservable additional probes',()=>{
  const f=fixture();for(let i=0;i<256;i++)expect(f.gate.before(`read-${i}`,'Read',{})).toBeNull();
  expect(f.gate.before('overflow',f.plan.probes[0].tool,f.plan.probes[0].input)).toContain('correlation limit');
});
it.each([['gemini','mcp_platform_inspect'],['opencode','platform_inspect']])('uses only reviewed native tool aliases for %s', (runtime,alias)=>{
  const f=fixture();f.plan.probes[0].nativeNames={[runtime]:alias};f.save();
  const gate=new WorkerPreflight(f.root,()=>f.catalogue,()=>1000,runtime);
  expect(gate.before('probe',alias,{scope:'development'})).toBeNull();
  expect(gate.before('wrong','mcp__platform__inspect',{scope:'development'})).toBeTruthy();
  gate.after('probe',{caller:'test-maker',environment:'test-environment',canRead:true},false,alias);
  expect(gate.observed().probeIds).toContain('identity-target');
});
it('resolves the catalogue once and still detects changed pinned bytes on the next hook',()=>{
  const f=fixture();let discoveries=0;const gate=new WorkerPreflight(f.root,()=>{discoveries++;return f.catalogue;},()=>1000);
  for(let i=0;i<10;i++){gate.before(String(i),'Read',{});gate.after(String(i),{},false);gate.observed();}
  expect(discoveries).toBe(1);fs.writeFileSync(f.skillFile,'Changed bytes');expect(gate.blocker()).toContain('guidance changed');
});
it('allows unknown-target local discovery without granting authoring or QA authority',()=>{
  const f=fixture();fs.unlinkSync(f.file);const gate=new WorkerPreflight(f.root,()=>f.catalogue,()=>1000,'codex','discovery');
  expect(gate.configurationBlocker()).toBeNull();expect(gate.before('read','mcp__office__delivery_record',{action:'read'})).toBeNull();
  expect(gate.before('finding','mcp__office__delivery_record',{action:'finding'})).toBeNull();
  for(const name of ['exec_command','Edit','mcp__office__approve_release','mcp__platform__create'])expect(gate.before(name,name,{})).toContain('Read-only discovery');
  expect(gate.before('save','mcp__office__delivery_record',{action:'save'})).toBeTruthy();
  expect(gate.observed().ready).toBe(false);expect(gate.blocker()).toBeNull();
  expect(new WorkerPreflight(f.root,()=>f.catalogue).configurationBlocker()).toBeTruthy();
});
it('accepts reviewed discovery-only probes without treating them as authoring readiness',()=>{
  const f=fixture();f.plan.mode='discovery';f.plan.skills=[];f.plan.noSkillsReason='Read-only schema discovery before authoring guidance is chosen';f.plan.probes[0].assertions=[{kind:'access',pointer:['canRead'],equals:true}];f.save();
  const gate=new WorkerPreflight(f.root,()=>f.catalogue,()=>1000,'codex','discovery');expect(gate.before('probe',f.plan.probes[0].tool,f.plan.probes[0].input)).toBeNull();
  gate.after('probe',{canRead:true},false);expect(gate.before('edit','Edit',{})).toContain('Read-only discovery');
  expect(new WorkerPreflight(f.root,()=>f.catalogue).configurationBlocker()).toContain('Discovery-only');
});
