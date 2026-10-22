import {parseUnambiguousJson} from './unambiguousJson.ts';

/** Shared interpretation of bounded native/MCP observations. Transport completion is not semantic success. */
export function toolObservation(raw:unknown):{data:Record<string,unknown>|null;outcome:'success'|'failure'|'unknown'} {
  let value=raw,explicitSuccess=false;
  try{
    for(let depth=0;depth<6;depth++){
      if(typeof value==='string'){value=parseUnambiguousJson(value,{maxBytes:768*1024,maxDepth:32,maxSyntaxTokens:50000});continue;}
      if(!value||typeof value!=='object'||Array.isArray(value))break;
      const row=value as Record<string,unknown>;
      if(row.isError===true||row.error)return {data:null,outcome:'failure'};
      if(row.isError===false)explicitSuccess=true;
      if(row.structuredContent!==undefined){value=row.structuredContent;continue;}
      if(Array.isArray(row.content)){
        if(row.content.length!==1||row.content[0]?.type!=='text')break;
        value=row.content[0].text;continue;
      }
      return {data:row,outcome:explicitSuccess?'success':'unknown'};
    }
  }catch{/* Unstructured or truncated output cannot establish readiness. */}
  return {data:null,outcome:'unknown'};
}
