/** Independent test reader for public review framing; never execution authority. */
export function decodeReviewCapsule(text:string):any[]{
 const from=text.indexOf('{'),end=text.indexOf('\n\n',from);
 if(text.startsWith('{"schemaVersion":1',from))return JSON.parse(text.slice(from)).sources;
 const meta=JSON.parse(text.slice(from,end));let cursor=end+2;
 if(![2,3].includes(meta.schemaVersion))throw Error('Unknown review framing');
 const decoded=meta.sources.map((tuple:any[])=>{
  const part:any=Object.fromEntries(meta.columns.map((name:string,i:number)=>[name,tuple[i]]));
  const length=part.characterLength??part.endCharacter-part.startCharacter;
  if(!Number.isSafeInteger(length)||length<0||text.slice(cursor,cursor+meta.fence.length+1)!==meta.fence+'\n')throw Error('Invalid source opening');
  cursor+=meta.fence.length+1;part.text=text.slice(cursor,cursor+length);cursor+=length;
  if(part.text.length!==length||text.slice(cursor,cursor+meta.fence.length+1)!=='\n'+meta.fence)throw Error('Invalid source closing');
  cursor+=meta.fence.length+3;return part;
 });
 if(cursor-2!==text.length)throw Error('Unexpected trailing source');return decoded;
}
