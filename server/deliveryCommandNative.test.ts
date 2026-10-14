import {expect,it} from 'vitest';
import {deliveryCommands} from './delivery.ts';
const run=(script:string,signal=new AbortController().signal)=>deliveryCommands.run({executable:process.execPath,args:['-e',script]},process.cwd(),{},signal);
it('preserves native UTF-8 code points split across subprocess writes',async()=>{
  const expected='GBP £ — 東京 😀';const script=`const data=Buffer.from(${JSON.stringify(expected)});let index=0;const timer=setInterval(()=>{if(index===data.length){clearInterval(timer);}else{const chunk=data.subarray(index,index+1);index++;process.stdout.write(chunk);}},2);`;
  expect(await run(script)).toBe(expected);
});
it.each(['stdout','stderr'])('rejects malformed native %s bytes rather than accepting replacement characters',async stream=>{
  await expect(run(`process.${stream}.write(Buffer.from([255]));setInterval(()=>{},1000);`)).rejects.toThrow('invalid UTF-8');
});
it('rejects a truncated UTF-8 tail even when the native process exits successfully',async()=>{
  await expect(run('process.stdout.write(Buffer.from([226,130]));')).rejects.toThrow('invalid UTF-8');
});
it('bounds combined native output in bytes, including multibyte characters',async()=>{
  const script=`let count=0;const data=Buffer.from('東'.repeat(1024*1024));const timer=setInterval(()=>{(count%2?process.stderr:process.stdout).write(data);if(++count===3){clearInterval(timer);setInterval(()=>{},1000);}},10);`;
  await expect(run(script)).rejects.toThrow('exceeded its limit');
},15000);
