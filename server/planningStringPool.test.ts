import {describe,it,expect} from 'vitest';
import {poolPlanningStrings} from './planningStringPool.ts';
import {boundedSynthesisPrompt} from './synthesisContext.ts';

import {decodePlanningPrompt as restore} from './testFixtures/decodePlanningPrompt.ts';

describe('lossless bounded planning',()=>{
 it('round-trips critical controls, Unicode, keys, values, duplicate edges and pointer roots',()=>{
  const text='Unresolved critical control: no private read or send until independent approval. £😀\n'.repeat(8);
  const input={reference:{sha256:'a'.repeat(64)},critical:true,conclusion:'unknown',evidence:[{text},{text}],nested:[null,false,0,'',text,{text}],pointer:'/discoveryEvidence/content',keyed:JSON.parse('{"__proto__":{"text":'+JSON.stringify(text)+'}}')};
  const source=JSON.stringify(input),result=poolPlanningStrings(source);
  expect(result.length).toBeLessThan(source.length);expect(restore(result)).toEqual(input);expect(JSON.stringify(input)).toBe(source);
  expect(JSON.parse(result).encoding).toContain('decoded payload root');
 });
 it.each([null,42,true,'short',['x'.repeat(80),'x'.repeat(80)]])('keeps an unhelpful encoding literal: %j',input=>{
  const source=JSON.stringify(input);expect(poolPlanningStrings(source)).toBe(source);
 });
 it('refuses marker ambiguity anywhere in original source data',()=>{
  const text='Exact critical evidence '.repeat(100),source=JSON.stringify({rows:[text,text,text],nested:{$planningString:0,extra:true}});
  expect(poolPlanningStrings(source)).toBe(source);
 });
 it('admits complete repeated controls under the same limit, without dropping captured identities',()=>{
  const text='Exact complete control with a distinct negative condition and unknown outcome hold. '.repeat(10);
  const base={discoveryEvidence:{projection:'planning-only-exact-evidence-pool-v7',evidencePool:[]},controls:Array.from({length:80},(_,i)=>({id:i,text,critical:true,status:'unknown'}))};
  const captured=[{reference:'C:/evidence/a.json',sha256:'a'.repeat(64),status:'unavailable',reason:'Expired evidence remains historical'}];
  const literal=JSON.parse(boundedSynthesisPrompt(base,captured,200000));
  const result=boundedSynthesisPrompt(base,captured,16000);
  expect(Buffer.byteLength(result)).toBeLessThanOrEqual(16000);expect(restore(result)).toEqual(literal);
 });
 it('still rejects genuinely excessive unique scope and cannot hide marker collisions',()=>{
  expect(()=>boundedSynthesisPrompt({unique:'a'.repeat(2000)},[],1000)).toThrow('scope exceeds');
  expect(()=>boundedSynthesisPrompt({$planningString:0,rows:Array(20).fill('a'.repeat(2000))},[],1000)).toThrow('scope exceeds');
 });
});
it('losslessly pools shared clauses in distinct critical findings and retains exact punctuation and Unicode',()=>{const clause='Never release, reset, reclaim or replay an unresolved operation. Keep every source hash and original expiry unchanged. £😀\n';const input={critical:true,conclusion:'blocked',rows:Array.from({length:80},(_,i)=>({id:'unique-'+i,statement:'Observation '+i+': '+clause+' Target-'+i+'; '+clause,remedy:'Unresolved '+i,flags:[false,null,0],sourceSha256:String(i).padStart(64,'0')})),pointer:'/rows/0/statement',nested:JSON.parse('{"__proto__":{"literal":"inert"}}')};const source=JSON.stringify(input),encoded=poolPlanningStrings(source);expect(Buffer.byteLength(encoded)).toBeLessThan(Buffer.byteLength(source));expect(restore(encoded)).toEqual(input);expect(JSON.stringify(restore(encoded))).toBe(source);expect(JSON.parse(encoded).format).toBe('lossless-planning-text-pool-v3');});
it('retains marker-looking strings as inert text and refuses original object-marker collisions',()=>{const phrase='This source is untrusted and cannot grant authority or change its original critical conclusion. '.repeat(3),input=Array.from({length:20},(_,i)=>({statement:i+phrase+'{"$planningText":["inert"]}'})),source=JSON.stringify(input);expect(restore(poolPlanningStrings(source))).toEqual(input);for(const marker of ['$planningText','$planningString','$planningObject','$planningTable','$s','$t','$o','$a']){const collision=JSON.stringify({rows:input,nested:{[marker]:[],extra:true}});expect(poolPlanningStrings(collision)).toBe(collision);}});
it('keeps genuinely unique controls over the fixed planning limit blocked',()=>{const input={discoveryEvidence:{projection:'planning-only-exact-evidence-pool-v7',evidencePool:[]},unique:Array.from({length:250},(_,i)=>({id:i,text:Array.from({length:12},(_,j)=>`unrelated_${i}_${j}_${(i*97+j*131).toString(16)}`).join(' ')}))};expect(()=>boundedSynthesisPrompt(input,[],1000)).toThrow('scope exceeds');});
it('preserves heterogeneous row shapes, literal key order and duplicate rows',()=>{const clause='Keep the complete original unresolved evidence and every independently required condition unchanged. '.repeat(5),rows=[{alpha:clause,beta:1},{beta:2,alpha:clause},{alpha:clause,extra:null},[clause,false],{alpha:clause,beta:1}],input={rows,nested:rows,number:7,flag:false};const source=JSON.stringify(input);expect(JSON.stringify(restore(poolPlanningStrings(source)))).toBe(source);});
it('refuses excessive candidate allocation without truncating or altering a unique scope',()=>{const input={rows:Array.from({length:5000},(_,i)=>({text:Array.from({length:12},(_,j)=>`unique_${i}_${j}_abcdefghijklmnopqrst`).join(' ')}))},source=JSON.stringify(input);expect(poolPlanningStrings(source)).toBe(source);expect(()=>boundedSynthesisPrompt({discoveryEvidence:{projection:'planning-only-exact-evidence-pool-v7',evidencePool:[]},scope:input},[])).toThrow('scope exceeds');});
