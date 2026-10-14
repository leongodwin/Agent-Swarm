import {expect,it} from 'vitest';import {parseUnambiguousJson} from './unambiguousJson.ts';
it.each(['null','true','false','42','"value"','[]','{}','{"a":[{"a":1},{"a":2}],"A":3}','{"escaped\\\"key":"punctuation {},[]: and \\\"quoted\\\" text","path":"C:\\\\test"}'])('preserves valid JSON semantics: %s',text=>{expect(parseUnambiguousJson(text)).toEqual(JSON.parse(text));});
it.each(['{"a":1,"a":2}','{"owner":{},"own\\u0065r":null}','{"a":[{"x":1,"x":2}]}','{"constructor":1,"constructor":2}','{"__proto__":1,"__proto__":2}','{"\\uD83D\\uDE00":1,"😀":2}'])('rejects duplicate decoded keys without echoing data: %s',text=>{expect(()=>parseUnambiguousJson(text)).toThrow('ambiguity');});
it.each(['','{','{"secret":"private-value",}','{"a":invalid}','[1,]','{"a":"\\q"}'])('rejects malformed grammar without echoing configured values: %s',text=>{let error;try{parseUnambiguousJson(text);}catch(value){error=value;}expect(String(error)).toBe('Error: JSON grammar, ambiguity or processing limits could not be verified');expect(String(error)).not.toContain('private-value');});
it('enforces explicit byte, depth and syntax-token bounds before constructing objects',()=>{
  expect(parseUnambiguousJson('{"a":1}',{maxBytes:7,maxDepth:1,maxSyntaxTokens:4})).toEqual({a:1});
  expect(()=>parseUnambiguousJson('{"a":1}',{maxBytes:6})).toThrow();expect(()=>parseUnambiguousJson('[[0]]',{maxDepth:1})).toThrow();expect(()=>parseUnambiguousJson('[1,2,3]',{maxSyntaxTokens:3})).toThrow();
  expect(()=>parseUnambiguousJson('['.repeat(257)+'0'+']'.repeat(257))).toThrow();
});
it.each([{maxBytes:0},{maxDepth:NaN},{maxSyntaxTokens:1.5},{maxBytes:32*1024*1024+1},{maxDepth:257},{maxSyntaxTokens:2_000_001}])('rejects invalid or increased bounds: %j',bounds=>{expect(()=>parseUnambiguousJson('{}',bounds)).toThrow();});
