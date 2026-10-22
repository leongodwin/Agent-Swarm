/** Submit once only after Codex renders the pasted input. A busy TUI can process
 * Enter before processing a large paste, leaving the task unsent. */
export type PendingCodexPaste=(()=>void)&{pending:()=>boolean};
export function submitCodexPaste(options:{text:string;screen:()=>string;write:(text:string)=>void;current:()=>boolean;failed:()=>void}):PendingCodexPaste {
  const before=options.screen(),started=Date.now();
  let cancelled=false,acknowledged=false,timer:ReturnType<typeof setTimeout>|undefined;
  const cancel=Object.assign(()=>{cancelled=true;clearTimeout(timer);},{pending:()=>!cancelled});
  if(!options.current())return cancel;
  // The last native input prompt excludes earlier conversation/tool output.
  const input=(screen:string)=>{
    const matches=[...screen.matchAll(/(?:^|\n)› /g)],last=matches.at(-1);
    if(!last)return null;
    // The observed native model/status footer follows the editor on its own line.
    return screen.slice(last.index!+last[0].length).split(/\n\s*(?:(?:GPT-|gpt-)[^\n]* · |tab to queue message\b)/)[0].trimEnd();
  };
  const prior=input(before);
  if(prior===null||prior.trim()&&prior.trim()!=='Ask Codex to do anything'){cancel();options.failed();return cancel;}
  const marker=`[Pasted Content ${Array.from(options.text).length} chars]`;
  const rendered=(screen:string)=>{
    const active=input(screen);
    return active!==null&&screen!==before&&active!==prior&&(
      active===marker||options.text.length>0&&active===options.text.trimEnd());
  };
  options.write(`\x1b[200~${options.text}\x1b[201~`);
  const observe=()=>{
    if(cancelled||!options.current())return cancel();
    if(Date.now()-started>=10000){cancel();options.failed();return;}
    const seen=rendered(options.screen());
    if(acknowledged){cancel();if(seen)options.write('\r');else options.failed();return;}
    if(seen){acknowledged=true;timer=setTimeout(observe,100);return;}
    timer=setTimeout(observe,50);
  };
  timer=setTimeout(observe,50);
  return cancel;
}
