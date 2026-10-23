/** Lossless model-input encoding only. Never modifies the stored delivery record. */
export function poolPlanningStrings(serialized:string):string {
 const value:unknown=JSON.parse(serialized),counts=new Map<string,number>();let collision=false;
 const visit=(item:unknown):void=>{
  if(typeof item==='string'){if(item.length>=80)counts.set(item,(counts.get(item)??0)+1);}
  else if(Array.isArray(item))item.forEach(visit);
  else if(item&&typeof item==='object')for(const [key,child] of Object.entries(item)){if(key==='$planningString')collision=true;visit(child);}
 };
 visit(value);if(collision)return serialized;
 const strings=[...counts].filter(([,count])=>count>=2).map(([text])=>text);
 if(!strings.length)return serialized;
 const indices=new Map(strings.map((text,index)=>[text,index]));
 const encode=(item:unknown):unknown=>{
  if(typeof item==='string'&&indices.has(item))return {$planningString:indices.get(item)};
  if(Array.isArray(item))return item.map(encode);
  if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,encode(child)]));
  return item;
 };
 const result=JSON.stringify({format:'lossless-planning-string-pool-v1',encoding:'Before interpreting the payload, recursively replace ONLY each one-key object {$planningString:i} with the COMPLETE exact string stringPool[i]. Object keys stay literal. All JSON pointers and existing encodings refer to the decoded payload root. No text, condition, evidence, order or value is omitted. This is model-input compression only, never freshness, approval or runtime evidence.',stringPool:strings,payload:encode(value)});
 return Buffer.byteLength(result)<Buffer.byteLength(serialized)?result:serialized;
}
