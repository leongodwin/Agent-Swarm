import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {playwrightMcp,coordinatorBrowserEnabled} from './browserTools.ts';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-access-'));roots.push(root);return path.join(root,'access.json');}
it('selects the coordinator queue explicitly and never silently opens an isolated or extension browser',()=>{const file=fixture();expect(coordinatorBrowserEnabled(file)).toBe(false);fs.writeFileSync(file,JSON.stringify({schemaVersion:1,mode:'coordinator-handoff'}));expect(coordinatorBrowserEnabled(file)).toBe(true);expect(()=>playwrightMcp(undefined,file)).toThrow('coordinator handoff');fs.writeFileSync(file,JSON.stringify({schemaVersion:1,mode:'coordinator-handoff',endpoint:'http://127.0.0.1:62141/mcp'}));expect(()=>coordinatorBrowserEnabled(file)).toThrow();});
it('keeps the isolated browser default and opts into only a reviewed loopback MCP bridge',()=>{
 const file=fixture();expect(playwrightMcp(undefined,file).args).toContain('--isolated');
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,mode:'extension-shared',endpoint:'http://127.0.0.1:62141/mcp'}));
 const result=playwrightMcp(undefined,file);expect(result.command).toBe(process.execPath);expect(result.args[0]).toMatch(/browserProxy\.mjs$/);expect(result.args[1]).toBe('http://127.0.0.1:62141/mcp');expect(result.args).not.toContain('--isolated');
});
it.each(['http://evil.test:62141/mcp','http://0.0.0.0:62141/mcp','http://user:secret@127.0.0.1:62141/mcp','http://127.0.0.1:62141/mcp?token=secret','http://127.0.0.1:62141/other'])('rejects unsafe bridge endpoint %s without silently falling back',endpoint=>{const file=fixture();fs.writeFileSync(file,JSON.stringify({schemaVersion:1,mode:'extension-shared',endpoint}));expect(()=>playwrightMcp(undefined,file)).toThrow();});
it('refuses malformed, oversized, linked and duplicate-key access configuration',()=>{
 const file=fixture();for(const bytes of ['{',' '.repeat(4097),'{"schemaVersion":1,"schemaVersion":1,"mode":"extension-shared","endpoint":"http://127.0.0.1:62141/mcp"}']){fs.writeFileSync(file,bytes);expect(()=>playwrightMcp(undefined,file)).toThrow();}
 fs.writeFileSync(file,'{}');fs.linkSync(file,file+'.copy');expect(()=>playwrightMcp(undefined,file)).toThrow();
});
