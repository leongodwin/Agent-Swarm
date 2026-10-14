export interface JsonBounds {maxBytes:number;maxDepth:number;maxSyntaxTokens:number}
const defaults:JsonBounds={maxBytes:32*1024*1024,maxDepth:256,maxSyntaxTokens:2_000_000};
/** Check multiplicity before constructing the object: JSON.parse alone silently
 * discards duplicate keys, including equivalent escaped spellings. Errors never
 * echo keys or values. Existing consumer schema checks remain mandatory. */
export function parseUnambiguousJson(text:string,options:Partial<JsonBounds>={}):unknown{
  try{
    const limits={...defaults,...options};
    for(const key of Object.keys(defaults) as (keyof JsonBounds)[])if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>defaults[key])throw new Error();
    if(Buffer.byteLength(text,'utf8')>limits.maxBytes)throw new Error();
    const stack:(Set<string>|null)[]=[],keys:boolean[]=[];let count=0;
    for(const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)){
      if(++count>limits.maxSyntaxTokens)throw new Error();const part=token[0];
      if(part==='{'||part==='['){if(stack.length>=limits.maxDepth)throw new Error();stack.push(part==='{'?new Set():null);keys.push(part==='{');}
      else if(part==='}'||part===']'){stack.pop();keys.pop();}
      else if(part===','){if(stack.at(-1))keys[keys.length-1]=true;}
      else if(part.startsWith('"')&&keys.at(-1)){const key=JSON.parse(part);if(stack.at(-1)!.has(key))throw new Error();stack.at(-1)!.add(key);keys[keys.length-1]=false;}
    }
    return JSON.parse(text);
  }catch{throw new Error('JSON grammar, ambiguity or processing limits could not be verified');}
}
