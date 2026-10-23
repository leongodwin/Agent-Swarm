import {it,expect} from 'vitest';
import crypto from 'node:crypto';
import {synthesisRecordContext,synthesisCatalogueContext,boundedSynthesisPrompt,synthesisEvidenceReference} from './synthesisContext.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {phaseRecordFixture} from './testFixtures/phaseRecord.ts';
const evidenceFor=(view:NonNullable<ReturnType<typeof synthesisRecordContext>>,index:number)=>view.content.findings[index].evidence.map(e=>(()=>{const item=view.evidencePool[e.evidenceIndex];if('reference' in item)return item;const {referenceFromSha256,...rest}=item;return{...rest,reference:synthesisEvidenceReference(item,view.evidenceReferencePrefixes,true)};})());
it('retains current scope, critical findings and evidence while explicitly indexing omitted historical prose',()=>{
 const text='Historical proposal £ '.repeat(200),evidence=[{reference:'retained.json',sha256:'a'.repeat(64),observedAt:'2026-10-18T00:00:00Z',expiresAt:'2026-10-18T00:01:00Z'}];
 const record={id:'record',revision:93,sha256:'b'.repeat(64),content:{applicationSpec:{decisions:['unresolved']},taskPlan:{stopConditions:['fresh effective rights']},contracts:['full history required'],findings:[{id:'critical',critical:true,statement:text,remedy:text,evidence},{id:'historical',critical:false,statement:text,remedy:text,evidence}]}} as unknown as DeliveryRecord;
 const original=JSON.stringify(record),view=synthesisRecordContext(record)!;
 expect(view.reference).toEqual({id:record.id,revision:93,sha256:record.sha256});expect(view.content.applicationSpec).toEqual(record.content.applicationSpec);expect(view.content.taskPlan).toEqual(record.content.taskPlan);expect(view.content.contracts).toEqual(record.content.contracts);
 expect({...view.content.findings[0],evidence:evidenceFor(view,0)}).toEqual(record.content.findings[0]);expect(evidenceFor(view,1)).toEqual(evidence);
 expect(view.content.findings[1]).toMatchObject({omittedFields:['statement','remedy'],fullFindingBytes:Buffer.byteLength(JSON.stringify(record.content.findings[1])),fullFindingSha256:crypto.createHash('sha256').update(JSON.stringify(record.content.findings[1])).digest('hex')});expect(JSON.stringify(record)).toBe(original);
 expect(view.historyLimit).toContain('not resolved or approved');expect(view.content.findings[1]).not.toHaveProperty('statement');
});
it('retains whole verified evidence when it fits and explicitly marks omitted evidence without truncating',()=>{
 const refs=[{reference:'large',sha256:'a'.repeat(64),status:'captured',text:'£'.repeat(1000)},{reference:'small',sha256:'b'.repeat(64),status:'captured',text:'current source'}],original=JSON.stringify(refs);
 const text=boundedSynthesisPrompt({requirements:'exact original requirements'},refs,800),result=JSON.parse(text);
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(800);expect(result.capturedEvidence[0]).toMatchObject({reference:'large',sha256:'a'.repeat(64),status:'unavailable',textOmitted:true});expect(result.capturedEvidence[0].text).toBeUndefined();expect(result.capturedEvidenceOmissionRule).toContain('do not infer');expect(result.capturedEvidence[1]).toEqual(refs[1]);expect(JSON.stringify(refs)).toBe(original);
});
it('blocks oversized current scope instead of omitting requirements or increasing the bound',()=>{
 expect(()=>boundedSynthesisPrompt({contracts:'x'.repeat(2000)},[],1000)).toThrow('scope exceeds');expect(synthesisRecordContext(undefined)).toBeNull();
});
it('retains complete catalogue text when no discovery record can supply a same-prompt reference',()=>{const row={id:'standalone',kind:'delivery-requirement' as const,text:'Complete standalone requirement without a captured discovery record',sourceSha256:'a'.repeat(64)};expect(synthesisCatalogueContext([row],undefined)).toEqual([row]);});
it('does not refill saved history capacity with large evidence texts and retains their exact references',()=>{
 const refs=[{reference:'large-current-source',sha256:'a'.repeat(64),status:'captured',text:'x'.repeat(16*1024+1)},{reference:'small-contract',sha256:'b'.repeat(64),status:'captured',text:'Current exact contract'}];
 const value=JSON.parse(boundedSynthesisPrompt({contracts:'Current contracts stay whole'},refs));
 expect(value.capturedEvidence[0]).toMatchObject({reference:refs[0].reference,sha256:refs[0].sha256,status:'unavailable',textOmitted:true});expect(value.capturedEvidence[0]).not.toHaveProperty('text');expect(value.capturedEvidenceOmissionRule).toContain('do not infer');expect(value.capturedEvidence[1]).toEqual(refs[1]);expect(value.contracts).toBe('Current contracts stay whole');
});
it('shares omission instructions without losing any source identity or original failure reason at the bound',()=>{
 const refs:{reference:string;sha256:string;status:string;text?:string;reason?:string}[]=[...Array.from({length:24},(_,i)=>({reference:'source-'+i,sha256:i.toString(16).padStart(64,'0'),status:'captured',text:'x'.repeat(32768)})),{reference:'missing-source',sha256:'f'.repeat(64),status:'unavailable',reason:'Original digest mismatch'}],base={criticalContract:'x'.repeat(257000)},before=JSON.stringify(refs);
 const text=boundedSynthesisPrompt(base,refs),value=JSON.parse(text);
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262144);expect(value.criticalContract).toBe(base.criticalContract);
 expect(value.capturedEvidenceOmissionRule).toContain('textOmitted:true');expect(value.capturedEvidenceOmissionRule).toContain('do not infer');
 expect(value.capturedEvidence.slice(0,24)).toEqual(refs.slice(0,24).map(({text,...ref})=>({...ref,status:'unavailable',textOmitted:true})));
 expect(value.capturedEvidence[24]).toEqual(refs[24]);expect(JSON.stringify(refs)).toBe(before);
 expect(()=>boundedSynthesisPrompt({...base,additionalContract:'y'.repeat(3000)},refs)).toThrow('scope exceeds');
});
it('links captured identities losslessly to existing receipts without borrowing their freshness or changing source verification',()=>{
 const pool=Array.from({length:24},(_,i)=>({reference:'C:/owned/'+('path/'.repeat(40))+i+'.json',sha256:i.toString(16).padStart(64,'0'),observedAt:'2026-10-01T00:00:00Z',expiresAt:'2026-10-01T00:01:00Z'}));
 const refs:{reference:string;sha256:string;status:string;text?:string;reason?:string}[]=[...pool.map(({reference,sha256})=>({reference,sha256,status:'captured',text:'x'.repeat(32768)})),{reference:'C:/different/source.json',sha256:pool[0].sha256,status:'unavailable',reason:'Original source unavailable'}];
 const base={criticalContract:'x'.repeat(245000),discoveryEvidence:{projection:'planning-only-exact-evidence-pool-v5',evidencePool:pool}},before=JSON.stringify({base,refs});
 const text=boundedSynthesisPrompt(base,refs),value=JSON.parse(text);
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262144);expect(value.criticalContract).toBe(base.criticalContract);expect(value.discoveryEvidence).toEqual(base.discoveryEvidence);
 expect(value.capturedEvidenceIdentityRule).toContain('ONLY reference and sha256');expect(value.capturedEvidenceIdentityRule).toContain('no observation time, expiry, approval or readiness');
 const expanded=value.capturedEvidence.map(({sourceEvidenceIndex,...item}:any)=>sourceEvidenceIndex===undefined?item:{reference:pool[sourceEvidenceIndex].reference,sha256:pool[sourceEvidenceIndex].sha256,...item});
 expect(expanded.slice(0,24)).toEqual(refs.slice(0,24).map(({text,...item})=>({...item,status:'unavailable',textOmitted:true})));
 expect(expanded[24]).toEqual(refs[24]);expect(JSON.stringify({base,refs})).toBe(before);
 expect(()=>boundedSynthesisPrompt({...base,additional:'y'.repeat(10000)},refs)).toThrow('scope exceeds');
});
it.each([null,{projection:'other',evidencePool:[]},{projection:'planning-only-exact-evidence-pool-v5',evidencePool:null}])('retains literal source identity without a compatible same-prompt pool: %j',discoveryEvidence=>{
 const ref={reference:'exact.json',sha256:'a'.repeat(64),status:'captured',text:'Complete text'};
 const value=JSON.parse(boundedSynthesisPrompt({discoveryEvidence},[ref]));expect(value.capturedEvidence).toEqual([ref]);expect(value).not.toHaveProperty('capturedEvidenceIdentityRule');
});
it('does not merge identities with different digests and preserves indices around malformed or historical entries',()=>{
 const ref={reference:'exact.json',sha256:'a'.repeat(64),status:'captured',text:'Complete text'},pool=[null,'invalid',Object.create({reference:ref.reference,sha256:ref.sha256}),{reference:ref.reference,sha256:'b'.repeat(64)},{reference:ref.reference,sha256:ref.sha256,observedAt:'2020-01-01T00:00:00Z'}];
 const value=JSON.parse(boundedSynthesisPrompt({discoveryEvidence:{projection:'planning-only-exact-evidence-pool-v5',evidencePool:pool}},[ref]));
 expect(value.capturedEvidence).toEqual([{status:'captured',text:ref.text,sourceEvidenceIndex:4}]);expect(value.discoveryEvidence.evidencePool).toEqual(pool);expect(value.capturedEvidence[0]).not.toHaveProperty('observedAt');
});
it('keeps accumulated historical context within the existing bound and detects changes beyond an excerpt',()=>{
 const record={id:'record',revision:105,sha256:'b'.repeat(64),content:{contracts:['current executable contract'],findings:Array.from({length:160},(_,i)=>({id:'history-'+i,critical:false,status:'observed',conclusion:'blocked',statement:'Historical detail '.repeat(300),remedy:'Original remedy '.repeat(300),evidence:[{reference:'retained-'+i+'.json',sha256:'a'.repeat(64)}]}))}} as unknown as DeliveryRecord;
 const original=JSON.stringify(record),view=synthesisRecordContext(record)!;
 const prompt=JSON.parse(boundedSynthesisPrompt({discoveryEvidence:view},[]));
 expect(prompt.discoveryEvidence.content.findings).toHaveLength(160);
 const legacy=structuredClone(record);
 expect(()=>boundedSynthesisPrompt({discoveryEvidence:legacy},[])).toThrow('scope exceeds');
 expect(view.projection).toBe('planning-only-exact-evidence-pool-v6');
 const before=view.content.findings[0] as {fullFindingSha256:string};
 expect(view.content.findings[0]).not.toHaveProperty('statement');expect(view.content.findings[0]).not.toHaveProperty('remedy');
 expect(evidenceFor(view,0)).toEqual(record.content.findings[0].evidence);
 expect(JSON.stringify(record)).toBe(original);
 const short={...record,content:{...record.content,findings:[{...record.content.findings[0],statement:'x'.repeat(400),remedy:'y'.repeat(512)}]}};
 expect(synthesisRecordContext(short)!.content.findings[0]).not.toHaveProperty('statement');
 record.content.findings[0].statement+='Changed beyond visible excerpt';
 const after=synthesisRecordContext(record)!.content.findings[0] as typeof before;
 expect(after.fullFindingSha256).not.toBe(before.fullFindingSha256);
 const critical={...record,content:{...record.content,findings:[{...record.content.findings[0],critical:true,statement:'x'.repeat(256*1024)}]}};
 expect(()=>boundedSynthesisPrompt({discoveryEvidence:synthesisRecordContext(critical)},[])).toThrow('scope exceeds');
});
it('indexes only explicitly typed execution prose while retaining contracts, claims, evidence and exact-byte provenance for QA',()=>{
 const record=phaseRecordFixture(),finding=record.content.findings.find(f=>f.executionEvidence)!;
 finding.statement='Historical narrow metadata claim '.repeat(4000);finding.remedy='Original remedy '.repeat(4000);
 const original=JSON.stringify(record),view=synthesisRecordContext(record)!,indexed=view.content.findings.find(f=>f.id===finding.id)!;
 expect(indexed).toMatchObject({critical:true,conclusion:'blocked',executionEvidence:finding.executionEvidence,fullFindingSha256:crypto.createHash('sha256').update(JSON.stringify(finding)).digest('hex')});expect(evidenceFor(view,view.content.findings.findIndex(f=>f.id===finding.id))).toEqual(finding.evidence);
 expect(indexed).not.toHaveProperty('statement');expect(indexed).not.toHaveProperty('remedy');expect(JSON.stringify(record)).toBe(original);
 expect(JSON.parse(boundedSynthesisPrompt({discoveryEvidence:view},[])).discoveryEvidence.content.findings).toHaveLength(record.content.findings.length);
 expect(view.historyLimit).toContain('require future fresh server-owned checks');
 (finding.executionEvidence as any).probe='arbitrary-command';let full=synthesisRecordContext(record)!;let at=full.content.findings.findIndex(f=>f.id===finding.id);expect({...full.content.findings[at],evidence:evidenceFor(full,at)}).toEqual(finding);
 delete finding.executionEvidence;full=synthesisRecordContext(record)!;at=full.content.findings.findIndex(f=>f.id===finding.id);expect({...full.content.findings[at],evidence:evidenceFor(full,at)}).toEqual(finding);
});
it.each(['reference','sha256','observedAt','expiresAt'] as const)('shares exact receipt bytes without merging a different %s or losing any finding relationship',field=>{
 const record=phaseRecordFixture(),[first,second,third]=record.content.findings.filter(f=>f.id!=='security'),base=first.evidence[0];second.evidence=[{...base}];third.evidence=[{...base,[field]:field==='sha256'?'f'.repeat(64):field==='reference'?'other-original.json':'2026-01-01T00:00:00Z'}];
 const original=JSON.stringify(record),view=synthesisRecordContext(record)!,edges=(id:string)=>view.content.findings.find(f=>f.id===id)!.evidence;expect(view.evidencePool).toHaveLength(3);expect(edges(first.id)).toEqual(edges(second.id));expect(edges(third.id)).not.toEqual(edges(first.id));
 for(let i=0;i<record.content.findings.length;i++)expect(evidenceFor(view,i)).toEqual(record.content.findings[i].evidence);
 expect(view.evidenceEncoding).toContain('No receipt is renewed');expect(JSON.stringify(record)).toBe(original);
});
it('round-trips digest-named evidence paths without normalizing identities or omitting current contracts',()=>{
 const prefix='C:\\retained\\'+'folder\\'.repeat(30),evidence=Array.from({length:50},(_,i)=>{const sha256=i.toString(16).padStart(64,'0');return{reference:prefix+sha256+'.json',sha256,observedAt:'2026-10-21T00:00:00.000Z',expiresAt:'2026-10-22T00:00:00.000Z'};});
 const record={id:'record',revision:1,sha256:'a'.repeat(64),content:{contracts:['Keep every critical contract and expiry unchanged.'],findings:[{id:'current',critical:true,statement:'Current critical finding',remedy:'Retain exact proof',evidence}]}} as unknown as DeliveryRecord,original=JSON.stringify(record),view=synthesisRecordContext(record)!;
 expect(view.evidenceReferencePrefixes).toEqual([prefix]);expect(evidenceFor(view,0)).toEqual(evidence);expect(view.content.contracts).toEqual(record.content.contracts);expect(view.content.findings[0]).toHaveProperty('statement','Current critical finding');expect(JSON.stringify(record)).toBe(original);
 const text=boundedSynthesisPrompt({discoveryEvidence:view},evidence.slice(0,2).map(e=>({reference:e.reference,sha256:e.sha256,status:'captured',text:'Exact source'})),20000),parsed=JSON.parse(text);
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(20000);expect(parsed.capturedEvidence.map((e:any)=>e.sourceEvidenceIndex)).toEqual([0,1]);
 const legacy={...view,projection:'planning-only-exact-evidence-pool-v5',evidencePool:evidence};expect(()=>boundedSynthesisPrompt({discoveryEvidence:legacy},[],20000)).toThrow('scope exceeds');
});
it('does not derive a reference from a mismatched filename or a lone path',()=>{
 const sha256='a'.repeat(64),evidence=[{reference:'C:/original/'+ 'b'.repeat(64)+'.json',sha256,observedAt:'2026-10-21T00:00:00Z',expiresAt:'2026-10-22T00:00:00Z'}],record={content:{findings:[{id:'original',critical:true,evidence}]}} as unknown as DeliveryRecord,view=synthesisRecordContext(record)!;
 expect(view.evidencePool).toEqual(evidence);expect(view.evidenceReferencePrefixes).toEqual([]);
});
it.each([null,{referenceFromSha256:-1,sha256:'a'.repeat(64)},{referenceFromSha256:0.5,sha256:'a'.repeat(64)},{referenceFromSha256:8,sha256:'a'.repeat(64)},{referenceFromSha256:0,sha256:'not-a-digest'},{reference:'literal',referenceFromSha256:0,sha256:'a'.repeat(64)}])('rejects malformed prompt reference derivation: %j',value=>{expect(synthesisEvidenceReference(value,['C:/literal/'],true)).toBeUndefined();});
it('requires own literal prefix and digest properties and explicit v6 encoding permission',()=>{
 const sha256='a'.repeat(64),row={referenceFromSha256:0,sha256},prefixes:string[]=[];Object.setPrototypeOf(prefixes,['C:/inherited/']);
 expect(synthesisEvidenceReference(row,prefixes,true)).toBeUndefined();expect(synthesisEvidenceReference(row,['C:/literal/'])).toBeUndefined();expect(synthesisEvidenceReference(Object.create(row),['C:/literal/'],true)).toBeUndefined();
 expect(synthesisEvidenceReference(row,['C:/literal/'],true)).toBe('C:/literal/'+sha256+'.json');
});
it('keeps malformed digest-shaped input literal instead of producing an unresolvable path',()=>{
 const evidence=['2026-10-21T00:00:00Z','2026-10-21T00:01:00Z'].map(observedAt=>({reference:'C:/original/x.json',sha256:'x',observedAt,expiresAt:'2026-10-22T00:00:00Z'})),record={content:{findings:[{critical:true,evidence}]}} as unknown as DeliveryRecord;
 const view=synthesisRecordContext(record)!;expect(view.evidencePool).toEqual(evidence);expect(view.evidenceReferencePrefixes).toEqual([]);
});
