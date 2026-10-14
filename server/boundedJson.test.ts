import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {readBoundedJson,readBoundedBytes} from './boundedJson.ts';
const homes:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const home of homes.splice(0))await fs.rm(home,{recursive:true,force:true});});
async function file(){const home=await fs.mkdtemp(path.join(os.tmpdir(),'bounded-json-'));homes.push(home);return path.join(home,'state.json');}
it('preserves exact bytes including a BOM for digest verification while retaining legacy text decoding',async()=>{
  const target=await file(),bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('{"value":"£"}')]);await fs.writeFile(target,bytes);
  expect(await readBoundedBytes(target,bytes.length)).toEqual(bytes);expect(await readBoundedJson(target,bytes.length)).toEqual({value:'£'});
});
it('distinguishes a missing file from JSON null and reads an exact bounded document',async()=>{
  const target=await file();expect(await readBoundedJson(target)).toBeUndefined();
  await fs.writeFile(target,'null');expect(await readBoundedJson(target)).toBeNull();
  await fs.writeFile(target,'{"a":1}');expect(await readBoundedJson(target,7)).toEqual({a:1});
});
it.each(['{"active":true,"active":false}','{"active":true,"\\u0061ctive":false}','{"policy":{"enabled":false,"enabled":true}}'])('preserves ambiguous persisted evidence and refuses it: %s',async content=>{
 const target=await file();await fs.writeFile(target,content);await expect(readBoundedJson(target)).rejects.toThrow('ambiguity');expect(await fs.readFile(target,'utf8')).toBe(content);
});
it.each(['oversized','empty','invalid UTF-8','directory'] as const)('rejects %s input without changing the original file',async kind=>{
  const target=await file();
  if(kind==='directory')await fs.mkdir(target);
  else await fs.writeFile(target,kind==='oversized'?'{"a":123}':kind==='empty'?'':Buffer.from([123,34,120,34,58,34,255,34,125]));
  const before=kind==='directory'?null:await fs.readFile(target);
  await expect(readBoundedJson(target,kind==='oversized'?7:16)).rejects.toThrow();
  if(before)expect(await fs.readFile(target)).toEqual(before);
});
it('rejects growth during an actual file-handle read',async()=>{
  const target=await file();await fs.writeFile(target,'{"a":1}');
  const handle=await fs.open(target,'r');const original=handle.read.bind(handle);
  vi.spyOn(fs,'open').mockResolvedValueOnce(handle);
  vi.spyOn(handle,'read').mockImplementationOnce(async(...args:any[])=>{await fs.writeFile(target,'{"a":12345}');return (original as any)(...args);});
  await expect(readBoundedJson(target)).rejects.toThrow('changed during');
  expect(await fs.readFile(target,'utf8')).toBe('{"a":12345}');
});
it.each([0,-1,1.5,Infinity,65*1024*1024])('rejects invalid read limit %s',async limit=>{
  await expect(readBoundedJson(await file(),limit)).rejects.toThrow('Invalid JSON read limit');
});
