import {expect,it,vi,afterEach} from 'vitest';
const cli=vi.hoisted(()=>({output:'' as string|Buffer,errorOutput:'' as string|Buffer,input:vi.fn()}));
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 return {...real,execFile:(command:string,...args:any[])=>{
   if(command!=='gh')return (real.execFile as any)(command,...args);
   queueMicrotask(()=>args.at(-1)(null,Buffer.from(cli.output),Buffer.from(cli.errorOutput)));return {stdin:{end:cli.input}};
 }};
});
import {run,ghJson,CommandError} from './exec.ts';
afterEach(()=>{cli.output='';cli.errorOutput='';vi.clearAllMocks();});
it.each(['{"state":"OPEN","state":"CLOSED"}','{"state":"OPEN","\\u0073tate":"CLOSED"}','{"data":{"repository":null,"repository":{}}}'])('refuses ambiguous CLI metadata without echoing it: %s',async output=>{
 cli.output=output;await expect(ghJson(['synthetic-read'])).rejects.toThrow('ambiguity');
});
it('retains missing output and JSON null without inventing metadata',async()=>{
 expect(await ghJson(['synthetic-read'])).toBeNull();cli.output='null';expect(await ghJson(['synthetic-read'])).toBeNull();cli.output='{"state":"CLOSED"}';expect(await ghJson(['synthetic-read'])).toEqual({state:'CLOSED'});
});
it('uses actual native argument boundaries and stdin without shell interpretation',async()=>{
 const literal='$(not-a-command) %PRIVATE_VAR% `literal`';
 expect(await run(process.execPath,['-e','process.stdin.on("data",chunk=>process.stdout.write(process.argv[1]+"|"+chunk));',literal],{input:'synthetic\ninput'})).toBe(literal+'|synthetic\ninput');
});
it('preserves native command failure instead of resolving an empty success',async()=>{
 const error=await run(process.execPath,['-e','process.stderr.write("synthetic failure");process.exit(7)']).then(()=>null,error=>error);
 expect(error).toBeInstanceOf(CommandError);expect(error.code).toBe(7);expect(error.stderr).toBe('synthetic failure');expect(error.observation).toMatchObject({kind:'exit',signal:null,killed:false});
});
it.each(['stdout','stderr'] as const)('refuses actual malformed UTF-8 on %s without exposing the output bytes',async stream=>{
 const script=`process.${stream}.write(Buffer.from([112,114,105,118,97,116,101,255]));`;
 const error=await run(process.execPath,['-e',script]).then(()=>null,error=>error);expect(error).toBeInstanceOf(CommandError);expect(error.observation.kind).toBe('encoding');expect(error.code).toBeNull();expect(error.stderr).toBe('');expect(error.message).not.toContain('private');
});
it('refuses malformed JSON metadata bytes before replacement characters can enter a response',async()=>{
 cli.output=Buffer.from([123,34,115,116,97,116,101,34,58,34,255,34,125]);await expect(ghJson(['synthetic-read'])).rejects.toThrow('encoding could not be verified');
});
it('decodes native Unicode exactly and preserves BOM-compatible text behavior',async()=>{
 expect(await run(process.execPath,['-e','process.stdout.write("\\ufeff£ 東京 😀\\n");'])).toBe('£ 東京 😀');
});
it('preserves a native missing-executable code without inventing an exit status',async()=>{
 const error=await run('swarm-fixture-missing-executable-01a12265',[]).then(()=>null,error=>error);expect(error).toBeInstanceOf(CommandError);expect(error.code).toBe('ENOENT');expect(error.observation).toEqual({kind:'spawn',signal:null,killed:false});
});
it('reports native deadline termination without claiming process-family cleanup',async()=>{
 const error=await run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}).then(()=>null,error=>error);expect(error).toBeInstanceOf(CommandError);expect(error.observation.kind).toBe('terminated');expect(error.observation.killed).toBe(true);expect(error.observation.signal).toBeTruthy();
});
it('reports the actual native output limit instead of accepting a truncated response',async()=>{
 const error=await run(process.execPath,['-e','process.stdout.write(Buffer.alloc(32*1024*1024+1,120));']).then(()=>null,error=>error);expect(error).toBeInstanceOf(CommandError);expect(error.code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');expect(error.observation.kind).toBe('output-limit');
});
it('retains a nonzero failure when stderr is empty',async()=>{
 const error=await run(process.execPath,['-e','process.exit(9)']).then(()=>null,error=>error);expect(error).toBeInstanceOf(CommandError);expect(error.code).toBe(9);expect(error.stderr).toBe('');expect(error.message).toContain('failed:');
});
