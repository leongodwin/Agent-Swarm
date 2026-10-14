export interface JsonBounds {maxBytes:number;maxDepth:number;maxSyntaxTokens:number}
const defaults:JsonBounds={maxBytes:32*1024*1024,maxDepth:256,maxSyntaxTokens:2_000_000};
const ceilings:JsonBounds={...defaults,maxBytes:64*1024*1024};
const invalid=()=>new Error('JSON grammar, ambiguity or processing limits could not be verified');
/** Inspect keys and bounds without constructing values. A downstream JSON parser
 * must still validate grammar. Linear scanning avoids regular-expression stack
 * exhaustion on large screenshot strings and avoids parsing HTTP bodies twice. */
export function verifyJsonStructure(text:string,options:Partial<JsonBounds>={}):void{
  try{
    const limits={...defaults,...options};
    for(const key of Object.keys(defaults) as (keyof JsonBounds)[])if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>ceilings[key])throw invalid();
    if(Buffer.byteLength(text,'utf8')>limits.maxBytes)throw invalid();
    const stack:(Set<string>|null)[]=[],keys:boolean[]=[];let count=0;
    const token=()=>{if(++count>limits.maxSyntaxTokens)throw invalid();};
    for(let index=0;index<text.length;index++){
      const char=text[index];
      if(char==='"'){
        token();const start=index;let ended=false,end=text.indexOf('"',index+1);
        // Native substring search skips large scalar values without instrumenting
        // every character. Odd preceding escape runs keep the quote inside the
        // string; all such runs are disjoint, preserving linear work.
        while(end>=0){let slashes=0;for(let cursor=end-1;cursor>start&&text[cursor]==='\\';cursor--)slashes++;if(slashes%2===0){index=end;ended=true;break;}end=text.indexOf('"',end+1);}
        if(!ended)throw invalid();
        if(keys.at(-1)){const key=JSON.parse(text.slice(start,index+1));if(stack.at(-1)!.has(key))throw invalid();stack.at(-1)!.add(key);keys[keys.length-1]=false;}
      }else if(char==='{'||char==='['){token();if(stack.length>=limits.maxDepth)throw invalid();stack.push(char==='{'?new Set():null);keys.push(char==='{');}
      else if(char==='}'||char===']'){token();if(!stack.length||(char==='}')!==(stack.at(-1)!==null))throw invalid();stack.pop();keys.pop();}
      else if(char===','){token();if(stack.at(-1))keys[keys.length-1]=true;}
      else if(char===':')token();
    }
    if(stack.length)throw invalid();
  }catch{throw invalid();}
}
/** Validate grammar as well as key multiplicity and resource bounds. Errors never
 * echo keys or values. Existing consumer schema checks remain mandatory. */
export function parseUnambiguousJson(text:string,options:Partial<JsonBounds>={}):unknown{
  try{verifyJsonStructure(text,options);return JSON.parse(text);}catch{throw invalid();}
}
