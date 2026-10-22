import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {WorkerPreflight,type WorkerPreflightPlan} from './workerPreflight.ts';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(dashed=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-alias-independent-'));roots.push(root);fs.mkdirSync(path.join(root,'.cubefarm'));
 const prefix=dashed?'mcp__synthetic-flow__':'mcp__synthetic_flow__',input={env:'synthetic-environment',connector:'synthetic_connector',connection:'synthetic-connection'};
 const plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Synthetic native name and object observation tests only',maxAgeSeconds:60,skills:[],noSkillsReason:'Protocol fixture tests require no platform authoring guidance',probes:[
 {id:'caller',tool:prefix+'whoami',readOnly:true,input:{},assertions:[{kind:'identity',pointer:['identity','username'],equals:'qa@example.test'}]},
 {id:'connection',tool:prefix+'test_connection',readOnly:true,input,assertions:[{kind:'target',pointer:['connection'],equals:'synthetic-connection'},{kind:'access',pointer:['connected'],equals:true},{kind:'identity',pointer:['accountName'],equals:'qa@example.test'}]},
 {id:'site',tool:prefix+'list_datasets',readOnly:true,input,assertions:[{kind:'target',pointer:['datasets','1','name'],equals:'https://synthetic.sharepoint.com/sites/Probe'}]},
 ]};
 const file=path.join(root,'.cubefarm/worker-preflight.json'),save=()=>fs.writeFileSync(file,JSON.stringify(plan));save();const gate=()=>new WorkerPreflight(root,()=>({fingerprint:'fixture',warnings:[],skills:[]}));return{root,file,plan,save,gate};
}
const observations=[{identity:{username:'qa@example.test'}},{connection:'synthetic-connection',connected:true,accountName:'qa@example.test'},{connector:'synthetic_connector',datasets:[{name:'https://synthetic.sharepoint.com/sites/Other'},{name:'https://synthetic.sharepoint.com/sites/Probe'}]}];
function observe(gate:WorkerPreflight,plan:WorkerPreflightPlan){for(const [index,p]of plan.probes.entries()){expect(gate.before(p.id,p.tool,p.input)).toBeNull();gate.after(p.id,{content:[{type:'text',text:JSON.stringify(observations[index])}]},false,p.tool);}}
it('rejects emitted underscore names against a dashed contract, then requires a fresh exact-name session',()=>{
 const f=fixture(true),old=f.gate(),emitted='mcp__synthetic_flow__whoami';expect(old.before('wrong',emitted,{})).toContain('exact reviewed');old.after('wrong',observations[0],false,emitted);expect(old.observed().probeIds).toEqual([]);
 for(const p of f.plan.probes)p.tool=p.tool.replace('synthetic-flow','synthetic_flow');f.save();expect(old.before('edit','Edit',{})).toContain('preflight changed');expect(old.configurationBlocker()).toContain('preflight changed');
 const fresh=f.gate();expect(fresh.blocker()).toContain('exact reviewed');observe(fresh,f.plan);expect(fresh.blocker()).toBeNull();expect(f.gate().observed().probeIds).toEqual([]);
});
it('requires exact explicit environment inputs and rejects failed connection object assertions',()=>{
 const f=fixture(),gate=f.gate(),p=f.plan.probes[1];expect(gate.before('implicit',p.tool,{connector:'synthetic_connector',connection:'synthetic-connection'})).toContain('exact reviewed');expect(gate.before('foreign',p.tool,{...p.input,env:'other-environment'})).toContain('exact reviewed');observe(gate,f.plan);expect(gate.blocker()).toBeNull();
 expect(gate.before('refresh',p.tool,p.input)).toBeNull();gate.after('refresh',{...observations[1],connected:false},false,p.tool);expect(gate.blocker()).toContain('exact reviewed');
});
it('fails closed on reordered datasets and never treats a top-level array as probe readiness',()=>{
 const f=fixture(),gate=f.gate();observe(gate,f.plan);const p=f.plan.probes[2];expect(gate.blocker()).toBeNull();
 expect(gate.before('reorder',p.tool,p.input)).toBeNull();gate.after('reorder',{datasets:[...observations[2].datasets!].reverse()},false,p.tool);expect(gate.blocker()).toContain('exact reviewed');
 expect(gate.before('array',p.tool,p.input)).toBeNull();gate.after('array',observations[2].datasets,false,p.tool);expect(gate.observed().probeIds).not.toContain(p.id);
});
