import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {createGeminiLiveRuntime} from './geminiLiveRuntime.ts';
it.each([
 ['scripts/verify-gemini-server-restart.ts','output/gemini-server-restart-live.json'],
 ['scripts/geminiRestartServer.ts','output/gemini-server-restart-live.json'],
 ['scripts/verify-scheduler-retry-live.ts','output/scheduler-retry-live.json'],
 ['scripts/verify-full-launcher-live.ts','output/full-launcher-live.json'],
])('refuses authenticated execution without live opt-in and preserves previous evidence: %s',async(script,report)=>{
 const before=fs.existsSync(report)?fs.readFileSync(report):null;
 await expect(promisify(execFile)(process.execPath,['--import','tsx',script],{windowsHide:true,timeout:10000})).rejects.toMatchObject({code:1,stderr:expect.stringContaining('Requires explicit --live')});
 expect(fs.existsSync(report)?fs.readFileSync(report):null).toEqual(before);
});
it('refuses an unscoped runtime before it can import native execution or open a server',async()=>{
 const outside=path.resolve(process.env.SWARM_HOME??'.','other-scope');
 await expect(createGeminiLiveRuntime(outside)).rejects.toThrow('Isolated runtime configuration is required');
});
