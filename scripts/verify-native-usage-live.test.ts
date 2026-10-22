import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
it('refuses live native execution without explicit opt-in and preserves any existing evidence report',async()=>{
 const report=path.resolve('output/native-usage-live.json'),before=fs.existsSync(report)?fs.readFileSync(report):null;
 await expect(promisify(execFile)(process.execPath,['--import','tsx','scripts/verify-native-usage-live.ts'],{windowsHide:true,timeout:10000})).rejects.toMatchObject({code:1,stderr:expect.stringContaining('Requires explicit --live')});
 expect(fs.existsSync(report)?fs.readFileSync(report):null).toEqual(before);
},15000); // Allow the existing ten-second child-process bound plus Windows/coverage startup overhead.

it('refuses Gemini live execution without explicit opt-in and preserves its authenticated evidence report',async()=>{
 const report=path.resolve('output/gemini-usage-live.json'),before=fs.existsSync(report)?fs.readFileSync(report):null;
 await expect(promisify(execFile)(process.execPath,['--import','tsx','scripts/verify-gemini-usage-live.ts'],{windowsHide:true,timeout:10000})).rejects.toMatchObject({code:1,stderr:expect.stringContaining('Requires explicit --live')});
 expect(fs.existsSync(report)?fs.readFileSync(report):null).toEqual(before);
},15000);
