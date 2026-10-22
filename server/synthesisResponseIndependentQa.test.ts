import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {synthesisOutputSchema} from '../shared/hldSynthesis.ts';
import {synthesisResponseGuidance,synthesisResponseSchema,expandSynthesisResponse} from './synthesisResponse.ts';
import {synthesisRequirements} from './synthesisTraceability.ts';
import {HldSynthesisService,type SynthesisDependencies} from './hldSynthesis.ts';
import type {SessionCallbacks,SessionOptions} from './agentRunner.ts';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
const base=()=>z.toJSONSchema(synthesisOutputSchema,{target:'draft-07'}) as any;

it('changes only the explicitly approved prose and decision/risk count bounds in the complete schema',()=>{
 const original=base(),expected=structuredClone(original);
 for(const key of ['summary','architecture','dataModel','securityAndGovernance','operationsAndRecovery'])expected.properties[key].maxLength=1200;
 for(const key of ['design','acceptance'])expected.properties.requirements.items.properties[key].maxLength=240;
 for(const key of ['topology','erd','sequence'])expected.properties.mermaidDiagrams.properties[key].maxLength=1600;
 for(const key of ['decisions','risks']){
  expected.properties[key].maxItems=8;
  for(const field of Object.values(expected.properties[key].items.properties) as any[])field.maxLength=600;
 }
 delete expected.properties.requirements.items.properties.sourceSha256;delete expected.properties.requirements.items.properties.requirement;
 expected.properties.requirements.items.required=expected.properties.requirements.items.required.filter((key:string)=>!['sourceSha256','requirement'].includes(key));
 expect(synthesisResponseSchema()).toEqual(expected);
 expect(base()).toEqual(original);
});

it('preserves required fields, source hashes, IDs, plan links, evidence and unverified skill constraints',()=>{
 const original=base(),compact=synthesisResponseSchema();
 expect(compact.required).toEqual(original.required);
 expect(compact.additionalProperties).toBe(false);
 const row=compact.properties.requirements.items,source=original.properties.requirements.items;
 expect(row.required).toEqual(source.required.filter((key:string)=>!['sourceSha256','requirement'].includes(key)));
 expect(compact.properties.requirements.minItems).toBe(original.properties.requirements.minItems);
 expect(compact.properties.requirements.maxItems).toBe(original.properties.requirements.maxItems);
 expect(row.properties.sourceSha256).toBeUndefined();
 for(const key of ['requirementId','planStepIds'])expect(row.properties[key]).toEqual(source.properties[key]);
 for(const key of ['design','acceptance'])expect(row.properties[key].minLength).toBe(20);
 for(const key of ['missingEvidence','skillBindings','implementationPlan'])expect(compact.properties[key]).toEqual(original.properties[key]);
 for(const key of ['decisions','risks'])expect(compact.properties[key].minItems).toBe(original.properties[key].minItems);
});

it('returns independent schemas so caller mutation cannot weaken subsequent inference contracts',()=>{
 const first=synthesisResponseSchema();first.properties.requirements.items.properties.requirementId.maxLength=9999;first.required=[];
 const next=synthesisResponseSchema();expect(next.required).toEqual(base().required);expect(next.properties.requirements.items.properties.requirementId).toEqual(base().properties.requirements.items.properties.requirementId);
});

it('passes the compact native contract and every unchanged catalogue source row to the real synthesis service',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthesis-response-qa-')),checkout=path.join(root,'repo');await fs.mkdir(checkout);
 let callbacks!:SessionCallbacks;
 const start=vi.fn((_options:SessionOptions,cb:SessionCallbacks)=>{callbacks=cb;return {stop:vi.fn(),send:vi.fn()};});
 const deps:SynthesisDependencies={reserve:()=>({running:vi.fn(),stopping:vi.fn(),release:vi.fn()}),assertOpen:()=>{},context:()=>({checkoutPath:checkout,fingerprint:'fixed',copilotPaused:true,skills:[]}),admission:async()=>null,start};
 const service=new HldSynthesisService(root,deps);await service.init();cleanup.push(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
 const input={solutionName:'Synthetic comprehensive design',problemContext:'Preserve all supplied requirements and evidence without omission.',components:Array.from({length:12},(_,i)=>({role:'Data',title:`Component ${i}`,badge:'Synthetic',details:`Distinct complete source requirement ${i}`,deliverables:[`Deliverable ${i}a`,`Deliverable ${i}b`]}))};
 const before=JSON.stringify(input),catalogue=synthesisRequirements(input),job=await service.start('synthetic/project',input);
 await vi.waitFor(()=>expect(start).toHaveBeenCalledOnce());const options=start.mock.calls[0][0],prompt=JSON.parse(options.prompt);
 expect(options.outputSchema).toEqual(synthesisResponseSchema());expect(options.systemAppend).toContain(synthesisResponseGuidance);
 expect(prompt.requirementCatalogue).toEqual(catalogue);expect(catalogue.length).toBeGreaterThan(24);expect(prompt.requirements).toEqual(input);expect(JSON.stringify(input)).toBe(before);
 expect(options.noTools).toBe(true);expect(options.authorizeTool?.()).toContain('no runtime tool authority');
 callbacks.finished({ok:true,text:'',costUsd:0,turns:1,errors:[],structured:wire(catalogue)});
 await vi.waitFor(()=>expect(service.view('synthetic/project',job.id)[0].status).toBe('completed'));
 const result=await service.result('synthetic/project',job.id);
 for(const source of catalogue){expect(result.result.markdownContent).toContain(source.sourceSha256);expect(result.result.markdownContent).toContain(source.text);}
});

const detail='Synthetic explicit design and independently observable acceptance evidence.';
function wire(catalogue:ReturnType<typeof synthesisRequirements>){return{summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,decisions:[{decision:detail,rationale:detail,alternatives:detail}],risks:[{risk:detail,mitigation:detail}],requirements:catalogue.map(source=>({requirementId:source.id,planStepIds:['data'],design:detail,acceptance:detail})),missingEvidence:['Actual tenant validation remains unavailable.'],skillBindings:[],implementationPlan:['data','app','verify'].map(id=>({id,title:id,deliverables:['Synthetic artifact'],acceptance:[detail]})),mermaidDiagrams:{topology:'flowchart LR\n A-->B',erd:'erDiagram\n REPORT ||--o{ ITEM : contains',sequence:'sequenceDiagram\n A->>B: Submit'}};}
const brief={solutionName:'Synthetic wire design',problemContext:'Preserve complete captured provenance and exact coverage.',components:[{role:'Data',title:'Item',badge:'Synthetic',details:'Complete synthetic data component contract',deliverables:['Short source']}]};
it('hydrates captured digests by exact ID despite reordering without mutating input or catalogue',()=>{
 const catalogue=synthesisRequirements(brief),raw=wire(catalogue);raw.requirements.reverse();const before=JSON.stringify({raw,catalogue});const expanded=expandSynthesisResponse(raw,catalogue);
 expect(JSON.stringify({raw,catalogue})).toBe(before);expect(expanded.requirements.map(row=>row.requirementId)).toEqual(raw.requirements.map(row=>row.requirementId));
 for(const row of expanded.requirements)expect(row.sourceSha256).toBe(catalogue.find(source=>source.id===row.requirementId)!.sourceSha256);
 expect(expanded.requirements[0].requirement).toBe(catalogue.find(source=>source.id===expanded.requirements[0].requirementId)!.text);expect(synthesisOutputSchema.parse(expanded)).toEqual(expanded);
});
it.each(['x','x'.repeat(9000),'x'.repeat(128*1024)])('hydrates exact source prose of length %s without truncation or rewriting',text=>{const catalogue=synthesisRequirements(brief);catalogue[0]={...catalogue[0],text};const result=expandSynthesisResponse(wire(catalogue),catalogue);expect(result.requirements[0].requirement).toBe(text);expect(result.requirements[0].requirement.length).toBe(text.length);});
it.each(['short','overlong','nonstring'])('legacy supplied requirement retains original prose constraints (%s)',mode=>{const catalogue=synthesisRequirements(brief),raw:any=wire(catalogue);raw.requirements[0].requirement=mode==='short'?'tiny':mode==='overlong'?'x'.repeat(8001):123;expect(()=>expandSynthesisResponse(raw,catalogue)).toThrow();});
it.each(['missing','duplicate','unknown','stale-hash','extra-field','root-extra','invalid-link-type','null-row','missing-prose'])('refuses %s wire content without source mutation',mode=>{
 const catalogue=synthesisRequirements(brief),raw:any=wire(catalogue),before=JSON.stringify(catalogue);
 if(mode==='missing')raw.requirements.pop();if(mode==='duplicate')raw.requirements[1]={...raw.requirements[0]};if(mode==='unknown')raw.requirements[0].requirementId='unknown';if(mode==='stale-hash')raw.requirements[0].sourceSha256='f'.repeat(64);if(mode==='extra-field')raw.requirements[0].approval=true;if(mode==='root-extra')raw.approved=true;if(mode==='invalid-link-type')raw.requirements[0].planStepIds='data';if(mode==='null-row')raw.requirements[0]=null;if(mode==='missing-prose')delete raw.requirements[0].design;
 expect(()=>expandSynthesisResponse(raw,catalogue)).toThrow();expect(JSON.stringify(catalogue)).toBe(before);
});
it('accepts a legacy full response only with every exact captured digest',()=>{
 const catalogue=synthesisRequirements(brief),raw=wire(catalogue),full={...raw,requirements:raw.requirements.map(row=>({...row,requirement:detail,sourceSha256:catalogue.find(source=>source.id===row.requirementId)!.sourceSha256}))};expect(expandSynthesisResponse(full,catalogue)).toEqual(full);
});
