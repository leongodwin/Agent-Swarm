import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {z} from 'zod';
import type {InstalledSkill} from './skillRegistry.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const workerMcpBindingSchema=z.strictObject({
  server:z.enum(['canvas_authoring','flowagent']),skillId:z.string().min(1).max(240),configurationSha256:hash,entrySha256:hash.optional(),
});
export type WorkerMcpBinding=z.infer<typeof workerMcpBindingSchema>;
export interface WorkerMcpServer {command:string;args:string[];cwd?:string;env?:Record<string,string>}
const sha=(bytes:Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');
function bounded(file:string,max=256*1024){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0||stat.size>max)throw Error('Installed MCP artifact is missing, linked or oversized');return fs.readFileSync(file);}
function canvasLauncher(args:string[]){
  const root=path.join(process.env.SWARM_HOME??path.join(os.homedir(),'.cubefarm'),'tools','dotnet');
  if(process.platform!=='win32'&&!fs.existsSync(path.join(root,'dotnet')))return {runtime:{command:'dnx',args} as WorkerMcpServer};
  const command=path.join(root,process.platform==='win32'?'dotnet.exe':'dotnet');
  const sdk=fs.readdirSync(path.join(root,'sdk')).filter(name=>/^\d+\.\d+\.\d+$/.test(name)&&Number(name.split('.')[0])>=10).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0];
  if(!sdk)throw Error('Canvas Authoring requires the office-managed .NET10 SDK');
  const entry=path.join(root,'sdk',sdk,'dotnet.dll');
  // Windows cannot reliably spawn dnx.cmd as an MCP stdio executable. Use the
  // SDK's actual native invocation, without a shell or changes to machine PATH.
  return {runtime:{command,args:['exec',entry,'dnx',...args]} as WorkerMcpServer,entrySha256:sha(Buffer.concat([bounded(command,32*1024*1024),bounded(entry,32*1024*1024),Buffer.from(entry)]))};
}
function artifacts(skill:InstalledSkill){
  if(skill.source!=='plugin'||!skill.version||!['canvas','power-automate'].includes(skill.platform))throw Error('Select an installed versioned Canvas or Power Automate plugin skill');
  const root=path.dirname(path.dirname(path.dirname(skill.file)));
  const configuration=bounded(path.join(root,'.mcp.json'));
  const config=parseUnambiguousJson(configuration.toString('utf8'),{maxBytes:256*1024}) as {mcpServers?:Record<string,unknown>};
  if(skill.platform==='canvas'){
    const value=z.strictObject({command:z.literal('dnx'),args:z.tuple([z.literal('Microsoft.PowerApps.CanvasAuthoring.McpServer'),z.literal('--yes')])}).parse(config.mcpServers?.['canvas-authoring']);
    return {server:'canvas_authoring' as const,configurationSha256:sha(configuration),...canvasLauncher([...value.args])};
  }
  // Launch the plugin entry directly: its inline launcher otherwise resolves cwd
  // to the worker checkout instead of the plugin and exits before exposing tools.
  if(!config.mcpServers?.flowagent)throw Error('Installed FlowAgent MCP configuration is missing');
  // The installed FlowAgent is a bundled JavaScript runtime (currently ~2.7 MiB),
  // substantially larger than its small MCP configuration manifest.
  const entry=path.join(root,'server','mcp.mjs'),bytes=bounded(entry,16*1024*1024);
  return {server:'flowagent' as const,configurationSha256:sha(configuration),entrySha256:sha(bytes),runtime:{command:process.execPath,args:[entry]} as WorkerMcpServer};
}
/** Proposed bindings are local installation facts, never runtime readiness. */
export function workerMcpBindings(skills:InstalledSkill[]){
  return skills.filter(s=>s.source==='plugin'&&['canvas','power-automate'].includes(s.platform)).map(skill=>{
    try{const {runtime:_,...binding}=artifacts(skill);return {skillId:skill.id,...binding,status:'requires-reviewed-contract-and-native-probes' as const};}
    catch{return {skillId:skill.id,status:'unavailable' as const};}
  });
}
export function resolveWorkerMcp(bindings:WorkerMcpBinding[],skills:InstalledSkill[]):Record<string,WorkerMcpServer>{
  const servers:Record<string,WorkerMcpServer>={};
  for(const raw of bindings){
    const binding=workerMcpBindingSchema.parse(raw),skill=skills.find(s=>s.id===binding.skillId);
    if(!skill)throw Error('MCP binding must reference a pinned skill');
    let current:ReturnType<typeof artifacts>;try{current=artifacts(skill);}catch{throw Error('Installed MCP binding changed or is unavailable; rediscover native runtime metadata');}
    if(current.server!==binding.server||current.configurationSha256!==binding.configurationSha256||current.entrySha256!==binding.entrySha256)throw Error('Installed MCP binding changed; review the current native runtime before restarting');
    if(servers[binding.server])throw Error('Duplicate worker MCP server');
    servers[binding.server]=current.runtime;
  }
  return servers;
}

/** FlowAgent's native CurrentEnvStore starts from PA_DEFAULT_ENVIRONMENT, not
 * from the manager's session. Pin only this child server to the reviewed target.
 * currentEnv proves configured context, not environment access or write rights. */
export function bindWorkerMcpTargets(servers:Record<string,WorkerMcpServer>,probes:{tool:string;input:Record<string,unknown>;assertions:{kind:string;pointer:string[];equals:unknown}[]}[]):Record<string,WorkerMcpServer>{
  if(!servers.flowagent)return servers;
  const targets=probes.filter(probe=>probe.tool==='mcp__flowagent__whoami'&&Object.keys(probe.input).length===0).flatMap(probe=>probe.assertions.filter(a=>a.kind==='target'&&a.pointer.length===1&&a.pointer[0]==='currentEnv').map(a=>a.equals));
  if(!targets.length)return servers;
  if(targets.some(target=>typeof target!=='string'||!/^(?:Default-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target))||new Set(targets).size!==1)throw Error('FlowAgent requires one exact reviewed environment GUID');
  return {...servers,flowagent:{...servers.flowagent,env:{...servers.flowagent.env,PA_DEFAULT_ENVIRONMENT:targets[0] as string}}};
}
/** Native FlowAgent returns a JSON array for this read. Preserve exact numeric
 * assertion pointers without admitting arbitrary arrays as readiness evidence. */
export function flowConnectionProbeObservation(tool:string,raw:unknown):Record<string,unknown>|null{
 if(tool!=='mcp__flowagent__list_connections')return null;
 try{let value=raw;for(let depth=0;depth<6;depth++){
  if(typeof value==='string'){value=parseUnambiguousJson(value,{maxBytes:768*1024,maxDepth:32,maxSyntaxTokens:50000});continue;}
  if(Array.isArray(value)){
   const rows=z.array(z.object({name:z.string().min(1),connector:z.string().regex(/^\/providers\/Microsoft\.PowerApps\/apis\/shared_[a-z0-9_]+$/i),status:z.string().min(1),accountName:z.string().nullable(),statuses:z.array(z.object({status:z.string()})).optional()}).passthrough()).max(1000).parse(value);
   if(new Set(rows.map(row=>row.name)).size!==rows.length||rows.some(row=>row.error||row.isError===true||row.statuses?.some(status=>status.status!==row.status)))return null;
   return Object.fromEntries(rows.map((row,index)=>[String(index),row]));
  }
  if(!value||typeof value!=='object')return null;const row=value as Record<string,unknown>;
  if(row.isError===true||row.error)return null;
  if(row.structuredContent!==undefined){value=row.structuredContent;continue;}
  if(Array.isArray(row.content)&&row.content.length===1&&row.content[0]?.type==='text'){value=row.content[0].text;continue;}
  return null;
 }}catch{/* Malformed, ambiguous or failed native output is never readiness. */}
 return null;
}

/** The native Canvas server returns anchored prose, not JSON, for these reads.
 * Only exact observed contracts are normalized; generic success text grants nothing. */
export function canvasProbeObservation(tool:string,raw:unknown):Record<string,unknown>|null{
  if(!['mcp__canvas_authoring__connect','mcp__canvas_authoring__list_accounts'].includes(tool)||!raw||typeof raw!=='object')return null;
  const result=raw as {isError?:boolean;error?:unknown;structuredContent?:unknown;content?:{type:string;text?:string}[]};
  if(result.isError||result.error||result.structuredContent!==undefined||result.content?.length!==1||result.content[0].type!=='text')return null;
  const text=result.content[0].text?.trim()??'';if(text.length>8192)return null;
  if(tool.endsWith('__connect')){
    const match=/^Successfully connected for app: ([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}), environment ([a-z0-9-]+)\. Signed in as: (\S+)\.(?: On any subsequent 'connect' call[^\r\n]*)?$/i.exec(text);
    return match?{appId:match[1].toLowerCase(),environmentId:match[2].toLowerCase(),username:match[3].toLowerCase(),connected:true}:null;
  }
  const lines=text.split(/\r?\n/);
  if(lines.shift()!=='Signed-in accounts:'||!lines.length||lines.some(line=>!/^-[ ]\S+(?: \(connected\))?$/.test(line)))return null;
  const accounts=lines.flatMap(line=>/^- ([^\s]+) \(connected\)$/.exec(line)?.[1].toLowerCase()??[]);
  return accounts.length===1?{username:accounts[0],connected:true}:null;
}
