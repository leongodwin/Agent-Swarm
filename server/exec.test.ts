import {expect,it,vi,afterEach} from 'vitest';
const cli=vi.hoisted(()=>({output:'',input:vi.fn()}));
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 return {...real,execFile:(command:string,...args:any[])=>{
   if(command!=='gh')return (real.execFile as any)(command,...args);
   queueMicrotask(()=>args.at(-1)(null,cli.output,''));return {stdin:{end:cli.input}};
 }};
});
import {run,ghJson,CommandError} from './exec.ts';
afterEach(()=>{cli.output='';vi.clearAllMocks();});
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
 expect(error).toBeInstanceOf(CommandError);expect(error.code).toBe(7);expect(error.stderr).toBe('synthetic failure');
});
