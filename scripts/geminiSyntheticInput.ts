/** Match native interactive paste semantics: Enter must arrive after the paste was processed. */
export async function sendGeminiSyntheticPrompt(write:(text:string)=>void,prompt:string){
 if(!/^Reply exactly CUBEFARM_[A-Z_]+\. Do not use tools\.$/.test(prompt))throw new Error('Only fixed synthetic prompts may be injected');
 write(`\x1b[200~${prompt}\x1b[201~`);
 await new Promise<void>(resolve=>setTimeout(resolve,150));
 write('\r');
}
