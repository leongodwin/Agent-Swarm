import {it,expect} from 'vitest';
import {synthesisCatalogueContext,synthesisRecordContext,boundedSynthesisPrompt} from './synthesisContext.ts';
import {synthesisRequirements} from './synthesisTraceability.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
const input={solutionName:'Test planning',problemContext:'A complete bounded development test brief',components:[]};
it('references exact duplicate sources in the same prompt without losing text, identities or critical findings',()=>{
 const record={id:'record',revision:103,sha256:'a'.repeat(64),content:{requirements:[{id:'scan',text:'Read complete Inbox'}],applicationSpec:{'odd~/section':[{id:'report',text:'Unicode £ 😀 and exact JSON bytes'}]},contracts:['Current executable contract'],findings:[{id:'critical',critical:true,statement:'Unresolved security boundary',remedy:'Require independent review',evidence:[]}]}} as unknown as DeliveryRecord;
 const before=JSON.stringify(record),catalogue=synthesisRequirements(input as any,record);
 const projected=synthesisCatalogueContext(catalogue,record);
 const prompt=JSON.parse(boundedSynthesisPrompt({requirements:input,discoveryEvidence:synthesisRecordContext(record),requirementCatalogue:projected},[]));
 for(let i=0;i<catalogue.length;i++){
  const row=prompt.requirementCatalogue[i];
  expect(row.id).toBe(catalogue[i].id);expect(row.sourceSha256).toBe(catalogue[i].sourceSha256);
  const decoded=row.textSource?row.textSource.jsonPointer.slice(1).split('/').map((part:string)=>part.replace(/~1/g,'/').replace(/~0/g,'~')).reduce((value:any,key:string)=>value[key],prompt):undefined;
  expect(row.textSource?JSON.stringify(decoded):row.text).toBe(catalogue[i].text);
 }
 expect(projected.filter(row=>'textSource' in row)).toHaveLength(2);
 expect(prompt.discoveryEvidence.content.findings).toEqual(record.content.findings);
 expect(prompt.discoveryEvidence.content.contracts).toEqual(record.content.contracts);
 expect(JSON.stringify(record)).toBe(before);
 const mismatched=catalogue.map(row=>({...row,text:row.text+' changed'}));
 expect(synthesisCatalogueContext(mismatched,record)).toEqual(mismatched);
 expect(synthesisCatalogueContext(catalogue,undefined)).toEqual(catalogue);
});
it('fits duplicate-heavy scope under the unchanged bound while still blocking genuinely oversized scope',()=>{
 const record={id:'record',revision:103,sha256:'b'.repeat(64),content:{requirements:[],applicationSpec:{scenarios:Array.from({length:35},(_,i)=>({id:'scenario-'+i,text:'Complete executable contract £ '.repeat(80)}))},contracts:['x'.repeat(95_000)],findings:[{id:'critical',critical:true,statement:'y'.repeat(40_000),remedy:'Preserve all critical prose',evidence:[]}]}} as unknown as DeliveryRecord;
 const catalogue=synthesisRequirements(input as any,record),base={requirements:input,discoveryEvidence:synthesisRecordContext(record)};
 expect(()=>boundedSynthesisPrompt({...base,requirementCatalogue:catalogue},[])).toThrow('scope exceeds');
 const prompt=boundedSynthesisPrompt({...base,requirementCatalogue:synthesisCatalogueContext(catalogue,record)},[]);
 expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(256*1024);
 expect(JSON.parse(prompt).discoveryEvidence.content.findings[0].statement).toBe(record.content.findings[0].statement);
 expect(()=>boundedSynthesisPrompt({...base,requirementCatalogue:synthesisCatalogueContext(catalogue,record),additional:'z'.repeat(100_000)},[])).toThrow('scope exceeds');
});
