import {it,expect} from 'vitest';
import crypto from 'node:crypto';
import {synthesisRecordContext,synthesisCatalogueContext,boundedSynthesisPrompt} from './synthesisContext.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {phaseRecordFixture} from './testFixtures/phaseRecord.ts';
const evidenceFor=(view:NonNullable<ReturnType<typeof synthesisRecordContext>>,index:number)=>view.content.findings[index].evidence.map(e=>view.evidencePool[e.evidenceIndex]);
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
 const refs=[...Array.from({length:24},(_,i)=>({reference:'source-'+i,sha256:i.toString(16).padStart(64,'0'),status:'captured',text:'x'.repeat(32768)})),{reference:'missing-source',sha256:'f'.repeat(64),status:'unavailable',reason:'Original digest mismatch'}],base={criticalContract:'x'.repeat(257000)},before=JSON.stringify(refs);
 const text=boundedSynthesisPrompt(base,refs),value=JSON.parse(text);
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262144);expect(value.criticalContract).toBe(base.criticalContract);
 expect(value.capturedEvidenceOmissionRule).toContain('textOmitted:true');expect(value.capturedEvidenceOmissionRule).toContain('do not infer');
 expect(value.capturedEvidence.slice(0,24)).toEqual(refs.slice(0,24).map(({text,...ref})=>({...ref,status:'unavailable',textOmitted:true})));
 expect(value.capturedEvidence[24]).toEqual(refs[24]);expect(JSON.stringify(refs)).toBe(before);
 expect(()=>boundedSynthesisPrompt({...base,additionalContract:'y'.repeat(3000)},refs)).toThrow('scope exceeds');
});
it('keeps accumulated historical context within the existing bound and detects changes beyond an excerpt',()=>{
 const record={id:'record',revision:105,sha256:'b'.repeat(64),content:{contracts:['current executable contract'],findings:Array.from({length:160},(_,i)=>({id:'history-'+i,critical:false,status:'observed',conclusion:'blocked',statement:'Historical detail '.repeat(300),remedy:'Original remedy '.repeat(300),evidence:[{reference:'retained-'+i+'.json',sha256:'a'.repeat(64)}]}))}} as unknown as DeliveryRecord;
 const original=JSON.stringify(record),view=synthesisRecordContext(record)!;
 const prompt=JSON.parse(boundedSynthesisPrompt({discoveryEvidence:view},[]));
 expect(prompt.discoveryEvidence.content.findings).toHaveLength(160);
 const legacy=structuredClone(record);
 expect(()=>boundedSynthesisPrompt({discoveryEvidence:legacy},[])).toThrow('scope exceeds');
 expect(view.projection).toBe('planning-only-exact-evidence-pool-v5');
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
