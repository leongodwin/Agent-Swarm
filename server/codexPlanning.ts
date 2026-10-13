import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {commandFor} from './clis.ts';
import type {SessionOptions,SessionCallbacks,SessionHandle,SessionResult} from './agentRunner.ts';
import {terminalCallback} from './terminalCallbacks.ts';

/** Planning uses a separate empty directory and accepts only a bounded structured final answer. */
export function startCodexPlanning(opts:SessionOptions,cb:SessionCallbacks):SessionHandle {
  if(opts.cli&&opts.cli!=='codex')throw new Error('Structured synthesis uses Codex; provider substitution is disabled');
  if(!opts.noTools||!opts.outputSchema)throw new Error('Nonterminal execution requires structured planning');
  const command=commandFor('codex');if(!command)throw new Error('Codex CLI is not installed');
  let child:ReturnType<typeof spawn>|undefined,stopped=false;
  let delivered=false;
  const finished=(result:SessionResult)=>{if(delivered)return;delivered=true;terminalCallback(cb.finished,result,()=>console.warn('Planning completion callback failed; result was not redelivered'));};
  void (async()=>{
    let dir:string|undefined;
    try {
      dir=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-codex-planning-'));
      await fs.writeFile(path.join(dir,'schema.json'),JSON.stringify(opts.outputSchema));
      if(stopped){finished({ok:false,text:'',errors:['Cancelled before launch'],turns:0,costUsd:0});return;}
      const disabled=['shell_tool','unified_exec','apps','browser_use','browser_use_external','computer_use','image_generation','multi_agent','memories','hooks','skill_search','workspace_dependencies','code_mode_host','view_image'];
      const args=[...command.args,'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','--output-schema',path.join(dir,'schema.json'),'-c','web_search="disabled"',...disabled.flatMap(feature=>['--disable',feature]),'-'];
      child=spawn(command.file,args,{cwd:dir,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='',failure='',bytes=0;
      const collect=(chunk:Buffer,isError:boolean)=>{bytes+=chunk.length;if(bytes>3*1024*1024){failure='Codex planning output exceeded its bound';child?.kill();return;}if(isError)stderr+=chunk.toString();else stdout+=chunk.toString();};
      child.stdout?.on('data',chunk=>collect(chunk,false));child.stderr?.on('data',chunk=>collect(chunk,true));
      child.on('error',error=>{failure=error.message;});
      child.stdin?.on('error',error=>{failure=error.message;child?.kill();});
      child.stdin?.end(`${opts.systemAppend}\n\n${opts.prompt}`);
      const code=await new Promise<number|null>(resolve=>child!.once('close',resolve));
      let text='',turns=0;
      try {
        for(const line of stdout.split(/\r?\n/).filter(Boolean)) {
          const event=JSON.parse(line);
          if(event.type==='item.completed'&&event.item?.type==='agent_message'){text=event.item.text;turns++;}
          if(event.item&&['command_execution','mcp_tool_call','web_search','file_change'].includes(event.item.type))failure='Planning emitted a forbidden tool event';
          if(event.type==='error'||event.type==='turn.failed')failure=String(event.message??event.error?.message??'Codex planning failed');
        }
        const structured=code===0&&!stopped&&!failure?JSON.parse(text):undefined;
        finished({ok:code===0&&!stopped&&!failure,text,structured,turns,costUsd:0,errors:failure||code!==0||stopped?[failure||(stopped?'Cancelled':stderr.slice(-4000)||`Codex exited ${code}`)]:[]});
      }catch(error){finished({ok:false,text:'',turns,costUsd:0,errors:[String(error)]});}
    }catch(error){finished({ok:false,text:'',turns:0,costUsd:0,errors:[String(error)]});}
    finally{if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
  })();
  return {send(){throw new Error('Planning input is immutable');},stop(){stopped=true;child?.kill();}};
}
