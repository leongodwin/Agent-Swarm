import {expect,it,vi} from 'vitest';
import {memoizeTextDerivation} from './pureTextDerivation.ts';
it('reuses only exact immutable text and recalculates changed bytes',()=>{
 const derive=vi.fn((text:string)=>text.toUpperCase()),run=memoizeTextDerivation(derive);
 expect(run('source')).toBe('SOURCE');expect(run('source')).toBe('SOURCE');expect(derive).toHaveBeenCalledTimes(1);
 expect(run('source\r\n')).toBe('SOURCE\r\n');expect(derive).toHaveBeenCalledTimes(2);
});
it('does not cache a failed calculation or poison another private instance',()=>{
 const derive=vi.fn((text:string)=>{if(text==='bad')throw Error('invalid');return text;}),run=memoizeTextDerivation(derive);
 expect(run('')).toBe('');expect(run('')).toBe('');expect(()=>run('bad')).toThrow();expect(()=>run('bad')).toThrow();expect(run('')).toBe('');expect(derive).toHaveBeenCalledTimes(3);
 expect(memoizeTextDerivation(()=> 'separate')('')).toBe('separate');expect(run('')).toBe('');
});
