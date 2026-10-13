import fs from 'node:fs/promises';
import path from 'node:path';
import {run} from './exec.ts';

export function geminiProfilePath(browser=false){
  return path.join(process.platform==='win32'?(process.env.ProgramFiles??'C:/Program Files'):'/etc','Agent Swarm','Gemini',browser?'browser-settings.json':'settings.json');
}

/** Use the installed CLI's own security validator; never weaken its administrator ownership rules. */
export async function verifyGeminiProfile(command:{file:string;args:string[]}|null,browser=false,profile=geminiProfilePath(browser)):Promise<string|null>{
  try{await fs.access(profile);}catch{return 'Gemini requires a protected governance profile. Prepare and review scripts/prepare-gemini-governance.ts, then install its artifacts as administrator.';}
  try{
    const config=JSON.parse(await fs.readFile(profile,'utf8'));
    const hook=path.join(path.dirname(profile),'gemini-hook.cjs');
    if(await fs.readFile(hook,'utf8')!==GEMINI_HOOK_SOURCE)return 'The protected Gemini bridge is outdated; review and install the current version before execution';
    if(config.hooksConfig?.enabled!==true||!Array.isArray(config.hooksConfig.disabled)||config.hooksConfig.disabled.length)return 'Gemini governance hooks are disabled or unverifiable; execution denied';
    if(config.mcpServers?.office?.httpUrl!=='${CUBEFARM_OFFICE_URL}')return 'Gemini office tools are not bound to the current session; execution denied';
    for(const event of ['SessionStart','BeforeAgent','BeforeTool','AfterTool','AfterAgent']){
      if(!config.hooks?.[event]?.some((group:any)=>(!['BeforeTool','AfterTool'].includes(event)||group.matcher==='.*')&&group.hooks?.some((entry:any)=>entry.command===`"${process.execPath}" "${hook}" ${event}`&&entry.type==='command'&&entry.timeout===20000)))return 'Gemini required governance hook configuration does not match the current bridge; execution denied';
    }
  }catch{return 'Gemini protected-profile contents could not be verified; execution denied';}
  const entry=command?.args.find(arg=>/gemini\.[cm]?js$/i.test(arg));
  if(!entry)return 'Gemini native security validation is unavailable for this CLI installation; verify adapter compatibility before execution';
  const folder=path.dirname(entry);
  for(const name of await fs.readdir(folder)){
    if(!/^chunk-.*\.js$/.test(name))continue;
    const source=await fs.readFile(path.join(folder,name),'utf8');
    const exports=source.slice(source.lastIndexOf('export {'));
    if(!exports.includes('isFileAndDirectorySecureSync'))continue;
    const code="import {pathToFileURL} from 'node:url';const native=await import(pathToFileURL(process.argv[1]).href);process.stdout.write(JSON.stringify(native.isFileAndDirectorySecureSync(process.argv[2])));";
    try{
      const result=JSON.parse(await run(process.execPath,['--input-type','module','-e',code,path.join(folder,name),profile],{timeoutMs:15000}));
      return result?.secure===true?null:'Gemini rejected the protected governance profile; verify administrator ownership and its native security-validation result';
    }catch{return 'Gemini protected-profile security validation could not be completed; execution denied';}
  }
  return 'The installed Gemini CLI does not expose the required native security validator; execution denied';
}

export function geminiSettings(command:string,servers:Record<string,unknown>={}) {
  return {hooksConfig:{enabled:true,disabled:[] as string[]},hooks:Object.fromEntries(['SessionStart','BeforeAgent','BeforeTool','AfterTool','AfterAgent','Notification'].map(event=>[event,[{...(['BeforeTool','AfterTool'].includes(event)?{matcher:'.*'}:{}),hooks:[{name:`swarm-${event}`,type:'command',command:`${command} ${event}`,timeout:20000}]}]])),mcpServers:servers};
}

/** Gemini treats ordinary hook failures as warnings, so denial uses its blocking exit code 2. */
export const GEMINI_HOOK_SOURCE=String.raw`
const expected=process.argv[2]??'BeforeTool';
const chunks=[];let bytes=0;
process.stdin.on('data',chunk=>{bytes+=chunk.length;if(bytes<=1024*1024)chunks.push(chunk);});
process.stdin.on('end',async()=>{
 let native={};
 try{
  native=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(bytes>1024*1024||native.hook_event_name!==expected)throw new Error();
  const endpoint=new URL(process.argv[3]??process.env.CUBEFARM_HOOK_URL);
  if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw new Error();
  const names={read_file:'Read',read_many_files:'Read',glob:'Glob',grep_search:'Grep',write_file:'Write',replace:'Edit',run_shell_command:'Bash'};
  const name=String(native.tool_name??'');
  const fields={...(native.tool_input??{})};
  const tool=names[name]??(name.startsWith('mcp_office_')?'mcp__office__'+name.slice(11):name.startsWith('mcp_playwright_')?'mcp__playwright__'+name.slice(15):name);
  const events={BeforeTool:'PreToolUse',AfterTool:'PostToolUse',BeforeAgent:'UserPromptSubmit',AfterAgent:'TurnComplete',SessionStart:'SessionStart',Notification:'Notification'};
  const bridgeSha256=require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(__filename)).digest('hex');
  const body={bridgeSha256,hook_event_name:events[native.hook_event_name]??native.hook_event_name,session_id:native.session_id,tool_name:tool,tool_input:fields,tool_use_id:native.tool_use_id??name,prompt:native.prompt,last_assistant_message:native.prompt_response,tool_response:native.tool_response,notification_type:native.notification_type==='ToolPermission'?'permission_prompt':native.notification_type};
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error();
  const answer=await response.json();
  if(native.hook_event_name==='BeforeTool'){
   if(answer?.hookSpecificOutput?.permissionDecision!=='allow')throw new Error();
   process.stdout.write(JSON.stringify({decision:'allow'}));
  }else process.stdout.write('{}');
 }catch{
  if(expected==='BeforeTool'||bytes>1024*1024){process.stdout.write(JSON.stringify({decision:'deny',reason:'Office authority or governance unavailable; execution denied'}));process.stderr.write('Office authority or governance unavailable; execution denied');process.exitCode=2;}
  else process.stdout.write('{}');
 }
});
`;
