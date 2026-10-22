import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {readBoundedJson} from './boundedJson.ts';
import {PlatformCommandError,providerErrorCode} from './platformCommandError.ts';
import {nativeEnvironment} from './pinnedPreparationContracts.ts';

export const nativeTreeProofSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),intentSha256:z.string().regex(/^[a-f0-9]{64}$/),mechanism:z.literal('windows-job-object-v1'),scope:z.literal('inherited-process-tree'),activeProcesses:z.literal(0),breakawayAllowed:z.literal(false),nativeTreeQuiescenceVerified:z.literal(true)});
export interface NativeTreeContext {id:string;intentSha256:string;proof:string;errorOutput?:string}
// Windows CommandLineToArgvW quoting; never execute a caller-built shell string.
export function windowsArgument(value:string){if(value&&!/[\s"]/.test(value))return value;return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}
export async function runNativeTree(file:string,args:string[],cwd:string,env:Record<string,string>,signal:AbortSignal,context:NativeTreeContext):Promise<string>{
 if(process.platform!=='win32')throw new Error('Certified native supervision requires Windows Job Objects');
 if([file,cwd,...args].some(value=>value.includes('\0'))||[file,...args].map(windowsArgument).join(' ').length>30000)throw new Error('Invalid or oversized native command');
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const host=spawn(process.execPath,[fileURLToPath(new URL('./nativeTreeBroker.mjs',import.meta.url))],{cwd,env:nativeEnvironment({...process.env,...env},args,file),windowsHide:true,detached:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',failure='',size=0;
  const out=new TextDecoder('utf-8',{fatal:true}),err=new TextDecoder('utf-8',{fatal:true});
  const stop=(reason:string)=>{failure ||= reason;host.stdin.end();};
  const deadline=setTimeout(()=>{stop('Native supervisor deadline exceeded');host.kill();},21*60_000);
  const abort=()=>stop('Delivery cancelled');signal.addEventListener('abort',abort,{once:true});
  host.stdin.on('error',()=>{failure ||= 'Native supervision control pipe failed';});
  const collect=(chunk:Buffer,isError:boolean)=>{size+=chunk.length;if(size>8*1024*1024){stop('Delivery output exceeded its limit');return;}try{const text=(isError?err:out).decode(chunk,{stream:true});if(isError)stderr+=text;else stdout+=text;}catch{stop('Delivery output contained invalid UTF-8');}};
  host.stdout.on('data',chunk=>collect(chunk,false));host.stderr.on('data',chunk=>collect(chunk,true));
  host.once('error',error=>{clearTimeout(deadline);signal.removeEventListener('abort',abort);reject(error);});
  host.once('close',code=>{clearTimeout(deadline);signal.removeEventListener('abort',abort);void(async()=>{
   try{stdout+=out.decode();stderr+=err.decode();}catch{failure ||= 'Delivery output contained invalid UTF-8';}
   const raw=await readBoundedJson(context.proof,16384);if(raw===undefined)throw new Error('Native supervisor exited without termination proof (exit '+code+'): '+stderr.slice(-4000));
   const proof=nativeTreeProofSchema.parse(raw);
   if(proof.id!==context.id||proof.intentSha256!==context.intentSha256)throw new Error('Native tree proof ownership mismatch');
   if(failure||code!==0){if(context.errorOutput)await fs.writeFile(context.errorOutput,JSON.stringify({stdout,stderr}),{flag:'wx',mode:0o600});const providerCode=providerErrorCode(stdout)??providerErrorCode(stderr),reported=stdout.split(/\r?\n/).filter(line=>/^\s*error\b/i.test(line)).join('\n').slice(-4000);throw new PlatformCommandError(`${path.basename(file)} failed: ${failure||stderr.slice(-4000)||reported||providerCode||`exit ${code}`}`,providerCode);}
   resolve(stdout);
  })().catch(reject);});
  // No payload is sent after cancellation. Closing stdin instructs the host to
  // terminate only its own job, including when the office dies unexpectedly.
  if(signal.aborted){abort();return;}
  host.stdin.write(JSON.stringify({...context,exe:file,commandLine:[file,...args].map(windowsArgument).join(' '),cwd})+'\n');
 });
}
