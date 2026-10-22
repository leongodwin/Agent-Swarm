import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
const journal='codex-instruction-profile.json';
const schema=z.strictObject({name:z.string().regex(/^cubefarm-instructions-[a-f0-9-]{36}$/),home:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
export interface CodexInstructionProfile {name:string;sha256:string}
function homeDirectory(home:string){const resolved=path.resolve(home),stat=fs.lstatSync(resolved);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(resolved)!==resolved)throw Error('Codex profile home must be an existing canonical directory');return resolved;}
export function createCodexInstructionProfile(directory:string,instructions:string,home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')){
 const root=homeDirectory(home),name='cubefarm-instructions-'+crypto.randomUUID(),file=path.join(root,name+'.config.toml'),content='developer_instructions='+JSON.stringify(instructions)+'\n';
 // Native --profile adds this one setting to the existing user configuration;
 // it does not replace CODEX_HOME, authentication, models, hooks or MCP settings.
 fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(directory,journal),JSON.stringify({name,home:root,sha256:hash(content)}),{flag:'wx',mode:0o600});
 verifyCodexInstructionProfile(directory);return name;
}
export function verifyCodexInstructionProfile(directory:string,expected?:CodexInstructionProfile){
 const metadata=path.join(directory,journal);if(!fs.existsSync(metadata)){if(expected)throw Error('Required Codex instruction profile journal is missing');return;}
 const marker=fs.lstatSync(metadata);if(!marker.isFile()||marker.isSymbolicLink()||marker.nlink!==1||marker.size>4096)throw Error('Codex instruction profile journal is invalid');
 const data=schema.parse(JSON.parse(fs.readFileSync(metadata,'utf8'))),home=homeDirectory(data.home),file=path.join(home,data.name+'.config.toml'),stat=fs.lstatSync(file);
 if(expected&&(data.name!==expected.name||data.sha256!==expected.sha256))throw Error('Codex instruction profile differs from retained process metadata');
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024||hash(fs.readFileSync(file,'utf8'))!==data.sha256)throw Error('Codex instruction profile changed; retained session is blocked');
 return {name:data.name,sha256:data.sha256,file};
}
export function removeCodexInstructionProfile(directory:string,expected?:CodexInstructionProfile){const data=verifyCodexInstructionProfile(directory,expected);if(data)fs.unlinkSync(data.file);}
export function finishCodexInstructionProfile(directory:string,expected:CodexInstructionProfile|undefined,retain:()=>void){try{removeCodexInstructionProfile(directory,expected);return true;}catch{retain();return false;}}
// Conservative UTF-16 upper bound including Windows quote/backslash escaping.
// Do not log command values: native MCP arguments may contain credentials.
export function assertWindowsCommandBound(file:string,args:string[]){const upper=[file,...args].reduce((n,s)=>n+2*s.length+3,0)+1;if(upper>32767)throw Error(`Windows native command exceeds its safe launch bound (${upper} UTF-16 units); no task was sent`);return upper;}
