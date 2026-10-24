export interface NativeReviewPart {name:string;startCharacter:number;endCharacter:number;sha256:string;text:string;}
/** Lossless readable framing: tuple order matches fenced bodies. The exact
 * UTF-16 body length is end-start; UTF-8 source hashes retain original bytes.
 * Tuples avoid repeated field names, never omit source or increase a limit. */
export function nativeReviewCapsule(entrySha256:string,sources:readonly NativeReviewPart[]){
 let longest=2;
 for(const source of sources){if(source.endCharacter-source.startCharacter!==source.text.length)throw Error('Native source range differs');for(const match of source.text.matchAll(/`+/g))longest=Math.max(longest,match[0].length);}
 const fence='`'.repeat(longest+1),metadata={schemaVersion:2,entrySha256,fence,columns:['name','startCharacter','endCharacter','sha256'],sources:sources.map(s=>[s.name,s.startCharacter,s.endCharacter,s.sha256])};
 return '# Complete exact native SDK source\n\nBodies follow tuple order. After each opening fence plus LF, read exactly endCharacter-startCharacter UTF-16 units. Every original byte is retained; UTF-8 item hashes and original-entry offsets are exact. One entry SHA binds every tuple. Ordinary MSAL/MCP/Node libraries are not reproduced.\n\n'+JSON.stringify(metadata)+'\n\n'+sources.map(s=>fence+'\n'+s.text+'\n'+fence).join('\n\n');
}

export interface ExactReviewSource {file:string;sha256:string;text:string;}
/** Full files use raw bodies so JSON escaping cannot consume the review budget. */
export function exactReviewCapsule(sources:readonly ExactReviewSource[]){
 let longest=2;for(const s of sources)for(const m of s.text.matchAll(/`+/g))longest=Math.max(longest,m[0].length);
 const fence='`'.repeat(longest+1);
 return '# Complete exact standalone source capsule\n\nBodies follow tuple order. Read exactly characterLength UTF-16 units after each opening fence plus LF. UTF-8 hashes bind every complete original file.\n\n'+JSON.stringify({schemaVersion:2,fence,columns:['file','sha256','characterLength'],sources:sources.map(s=>[s.file,s.sha256,s.text.length])})+'\n\n'+sources.map(s=>fence+'\n'+s.text+'\n'+fence).join('\n\n');
}
