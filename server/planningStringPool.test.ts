import {describe,it,expect} from 'vitest';
import {poolPlanningStrings} from './planningStringPool.ts';
import {boundedSynthesisPrompt} from './synthesisContext.ts';

function restore(serialized:string):unknown{
 const wrapper=JSON.parse(serialized);if(wrapper.format!=='lossless-planning-string-pool-v1')return wrapper;
 const decode=(value:any):any=>{
  if(Array.isArray(value))return value.map(decode);
  if(value&&typeof value==='object'){
   if(Object.keys(value).length===1&&Object.hasOwn(value,'$planningString'))return wrapper.stringPool[value.$planningString];
   return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,decode(child)]));
  }
  return value;
 };
 return decode(wrapper.payload);
}
describe('lossless bounded planning',()=>{
 it('round-trips critical controls, Unicode, keys, values, duplicate edges and pointer roots',()=>{
  const text='Unresolved critical control: no private read or send until independent approval. £😀\n'.repeat(8);
  const input={reference:{sha256:'a'.repeat(64)},critical:true,conclusion:'unknown',evidence:[{text},{text}],nested:[null,false,0,'',text,{text}],pointer:'/discoveryEvidence/content',keyed:JSON.parse('{"__proto__":{"text":'+JSON.stringify(text)+'}}')};
  const source=JSON.stringify(input),result=poolPlanningStrings(source);
  expect(result.length).toBeLessThan(source.length);expect(restore(result)).toEqual(input);expect(JSON.stringify(input)).toBe(source);
  expect(JSON.parse(result).encoding).toContain('decoded payload root');
 });
 it.each([null,42,true,'short',{text:'only once'.repeat(100)},['x'.repeat(80),'x'.repeat(80)]])('keeps an unhelpful encoding literal: %j',input=>{
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
