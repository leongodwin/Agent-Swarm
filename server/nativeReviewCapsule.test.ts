import crypto from 'node:crypto';import {expect,it} from 'vitest';
import {exactReviewCapsule,hostReviewCapsule,nativeReviewCapsule} from './nativeReviewCapsule.ts';
import {decodeReviewCapsule} from './testFixtures/decodeReviewCapsule.ts';
it('preserves host full-file hashes, exact ranges and Unicode source once',()=>{
 const text='\u{1f600}\r\n```\n',part={file:'server/synthetic.ts',fullSourceSha256:'a'.repeat(64),startCharacter:42,endCharacter:42+text.length,sha256:crypto.createHash('sha256').update(text).digest('hex'),text};
 expect(decodeReviewCapsule(hostReviewCapsule([part]))).toEqual([part]);
 expect(()=>hostReviewCapsule([{...part,endCharacter:1}])).toThrow('range differs');
 expect(()=>decodeReviewCapsule(hostReviewCapsule([part])+'unexpected')).toThrow();
});
it('retains complete file identity and Unicode bytes in full-file tuples',()=>{
 const bodies=['\u{1f600}\r\n```\n{"quoted":"\u00fc"}\n','second\r\n'];
 const sources=bodies.map((text,index)=>({file:'server/synthetic-'+index+'.ts',sha256:crypto.createHash('sha256').update(text).digest('hex'),text}));
 const encoded=exactReviewCapsule(sources),from=encoded.indexOf('{'),end=encoded.indexOf('\n\n',from),meta=JSON.parse(encoded.slice(from,end));
 expect(meta.columns).toEqual(['file','sha256','characterLength']);expect(meta.fence).toBe('````');let cursor=end+2;
 for(let i=0;i<sources.length;i++){
  const [file,hash,length]=meta.sources[i];expect(file).toBe(sources[i].file);expect(hash).toBe(sources[i].sha256);
  expect(encoded.slice(cursor,cursor+meta.fence.length+1)).toBe(meta.fence+'\n');cursor+=meta.fence.length+1;
  expect(Buffer.from(encoded.slice(cursor,cursor+length))).toEqual(Buffer.from(bodies[i]));cursor+=length;
  expect(encoded.slice(cursor,cursor+meta.fence.length+1)).toBe('\n'+meta.fence);cursor+=meta.fence.length+3;
 }
 expect(cursor-2).toBe(encoded.length);
});
it('frames original Unicode, line endings and embedded fences without escaping or dropping source bytes',()=>{const text='😀\r\n```\n{value:"ü"}\n',part={name:'synthetic:source',startCharacter:17,endCharacter:17+text.length,sha256:crypto.createHash('sha256').update(text).digest('hex'),text},encoded=nativeReviewCapsule('a'.repeat(64),[part]),start=encoded.indexOf('{'),end=encoded.indexOf('\n\n',start),metadata=JSON.parse(encoded.slice(start,end));expect(metadata.sources).toEqual([[part.name,part.startCharacter,part.endCharacter,part.sha256]]);expect(metadata.fence).toBe('````');const from=end+2+metadata.fence.length+1;expect(Buffer.from(encoded.slice(from,from+text.length))).toEqual(Buffer.from(text));expect(metadata.entrySha256).toBe('a'.repeat(64));});
it('refuses a body whose declared original range omits or invents characters',()=>expect(()=>nativeReviewCapsule('a'.repeat(64),[{name:'synthetic',startCharacter:0,endCharacter:1,sha256:'b'.repeat(64),text:'longer'}])).toThrow('range differs'));
