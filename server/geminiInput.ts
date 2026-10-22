/** Gemini 0.64 treats Enter within 30ms of processing paste as a newline.
 * Parent write spacing is insufficient when the child is busy. Observe its rendered
 * input first, then wait beyond the native 40ms unsafe-paste guard. Never replay. */
export function submitGeminiPaste(options:{text:string;screen:()=>string;write:(text:string)=>void;current:()=>boolean;failed:()=>void}):()=>void{
  const before=options.screen();
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,acknowledged=false;
  const started=Date.now();
  const cancel=()=>{cancelled=true;clearTimeout(timer);};
  if(!options.current())return cancel;
  const count=(screen:string,value:string)=>screen.split(value).length-1;
  const lines=options.text.split('\n').length;
  const label=lines>5?`${lines} lines`:`${options.text.length} chars`;
  const pattern=new RegExp(`\\[Pasted Text: ${label}(?: #\\d+)?\\]`,'g');
  const placeholder=(screen:string)=>lines>5||options.text.length>500?(screen.match(pattern)??[]).length:0;
  options.write(`\x1b[200~${options.text}\x1b[201~`);
  const observe=()=>{
    if(cancelled||!options.current())return cancel();
    const screen=options.screen();
    const rendered=screen!==before&&(placeholder(screen)>placeholder(before)||options.text.length>0&&count(screen,options.text)>count(before,options.text));
    if(acknowledged){cancel();if(!rendered){options.failed();return;}options.write('\r');return;}
    if(rendered){acknowledged=true;timer=setTimeout(observe,100);return;}
    if(Date.now()-started>=10000){cancel();options.failed();return;}
    timer=setTimeout(observe,50);
  };
  timer=setTimeout(observe,50);
  return cancel;
}
