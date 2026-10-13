import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import {z} from 'zod';

export interface HookSpec {event:string;command:string;timeout:number}
export interface HookRpc {request(method:string,params:unknown):Promise<any>;close():Promise<void>}
const metadata=z.object({key:z.string().min(1).max(8000),eventName:z.string(),handlerType:z.string(),command:z.string().optional(),source:z.string(),enabled:z.boolean(),isManaged:z.boolean(),currentHash:z.string().regex(/^sha256:[a-f0-9]{64}$/),trustStatus:z.enum(['managed','trusted','untrusted','modified']),matcher:z.string().nullable(),timeoutSec:z.number().int().nonnegative(),async:z.boolean().optional()});
const list=z.object({data:z.array(z.object({cwd:z.string(),hooks:z.array(metadata),warnings:z.array(z.string()),errors:z.array(z.unknown())})).min(1)});
const names:Record<string,string>={SessionStart:'sessionStart',UserPromptSubmit:'userPromptSubmit',PreToolUse:'preToolUse',PostToolUse:'postToolUse',Interrupt:'interrupt'};
let tail=Promise.resolve();

/** Trust only exact generated definitions. Other configured hooks retain their own native trust state. */
export async function establishCodexHookTrust(rpc:HookRpc,cwd:string,specs:HookSpec[],verifySource:()=>Promise<void>){
  const effective=await rpc.request('config/read',{includeLayers:false,cwd});
  if(effective.config?.features?.hooks!==true)throw new Error('Codex native hooks are disabled or unverifiable');
  const policy=await rpc.request('configRequirements/read',undefined);
  if(!policy||!('requirements' in policy)||policy.requirements!==null&&typeof policy.requirements.allowManagedHooksOnly!=='boolean'&&policy.requirements.allowManagedHooksOnly!==null)throw new Error('Managed Codex hook policy could not be verified');
  if(policy.requirements?.allowManagedHooksOnly===true||policy.requirements?.featureRequirements?.hooks===false)throw new Error('Managed Codex policy does not permit the generated office hooks');
  const before=list.parse(await rpc.request('hooks/list',{cwds:[cwd]}));
  const select=(inventory:z.infer<typeof list>)=>{
    const actual=path.resolve(inventory.data[0].cwd),expected=path.resolve(cwd);
    if(inventory.data.length!==1||(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)||inventory.data[0].errors.length)throw new Error('Codex hook inventory is unavailable or outside the requested directory');
    return specs.map(spec=>{
      const matches=inventory.data[0].hooks.filter(hook=>hook.eventName===names[spec.event]&&hook.command===spec.command&&hook.source==='sessionFlags');
      if(matches.length!==1)throw new Error('Required generated Codex hook is missing or ambiguous');
      const hook=matches[0];if(!hook.enabled||hook.isManaged||hook.handlerType!=='command'||hook.async||hook.timeoutSec!==spec.timeout||![null,'','*','.*'].includes(hook.matcher))throw new Error('Required Codex hook configuration cannot be verified');
      return hook;
    });
  };
  const hooks=select(before);await verifySource();
  for(const hook of hooks){
    if(hook.trustStatus==='trusted')continue;
    const config=await rpc.request('config/read',{includeLayers:true,cwd});
    const user=config.layers?.find((layer:any)=>layer.name?.type==='user'&&!layer.name.profile);
    if(!user?.name?.file||typeof user.version!=='string')throw new Error('Codex user configuration version is unavailable; trust changes denied');
    await verifySource();
    const written=await rpc.request('config/value/write',{keyPath:`hooks.state.${JSON.stringify(hook.key)}.trusted_hash`,value:hook.currentHash,mergeStrategy:'upsert',filePath:user.name.file,expectedVersion:user.version});
    if(written.status!=='ok'||written.overriddenMetadata)throw new Error('Codex hook trust could not be persisted without policy overrides');
  }
  const after=select(list.parse(await rpc.request('hooks/list',{cwds:[cwd]})));await verifySource();
  if(after.some((hook,index)=>hook.currentHash!==hooks[index].currentHash||hook.key!==hooks[index].key||hook.trustStatus!=='trusted'))throw new Error('Codex hook trust readback changed or is incomplete');
  return {verified:after.length,hashes:after.map(hook=>hook.currentHash)};
}

export function openCodexHookRpc(command:{file:string;args:string[]},cwd:string,specs:HookSpec[],env:NodeJS.ProcessEnv=process.env):HookRpc {
  const overrides=specs.flatMap(spec=>['-c',`hooks.${spec.event}=[{hooks=[{type="command",command=${JSON.stringify(spec.command)},timeout=${spec.timeout}}]}]`]);
  const child=spawn(command.file,[...command.args,'app-server','--enable','hooks',...overrides],{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let id=0,bytes=0,closed=false;const calls=new Map<number,{resolve:(result:any)=>void;reject:(error:Error)=>void}>();
  const fail=(reason:string)=>{for(const call of calls.values())call.reject(new Error(reason));calls.clear();child.kill();};
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)fail('Codex hook RPC output exceeded its bound');});child.stderr.on('data',()=>{});
  child.on('error',()=>fail('Codex hook RPC could not start'));child.stdin.on('error',()=>fail('Codex hook RPC transport failed'));
  const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{try{const reply=JSON.parse(line);const pending=calls.get(reply.id);if(pending){calls.delete(reply.id);reply.error?pending.reject(new Error('Codex hook RPC rejected the request')):pending.resolve(reply.result);}}catch{fail('Codex hook RPC returned malformed JSON');}});
  const ended=new Promise<void>(resolve=>child.once('close',()=>{closed=true;lines.close();for(const call of calls.values())call.reject(new Error('Codex hook RPC closed before completion'));calls.clear();resolve();}));
  const timer=setTimeout(()=>fail('Codex hook readiness exceeded its deadline'),20000);
  const request=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{if(closed){reject(new Error('Codex hook RPC is closed'));return;}const next=++id;calls.set(next,{resolve,reject});child.stdin.write(JSON.stringify({id:next,method,params})+'\n');});
  let initialized:Promise<void>|undefined;
  return {async request(method,params){initialized??=request('initialize',{clientInfo:{name:'agent-swarm-hook-governance',version:'1'},capabilities:{experimentalApi:true}}).then(()=>{child.stdin.write('{"method":"initialized"}\n');});await initialized;return request(method,params);},async close(){clearTimeout(timer);if(!closed){child.stdin.end();child.kill();}await ended;}};
}

export function prepareCodexHooks(command:{file:string;args:string[]},cwd:string,script:string,source:string,specs:HookSpec[]){
  const step=async()=>{
    const expected=crypto.createHash('sha256').update(source).digest('hex');
    const verify=async()=>{if(crypto.createHash('sha256').update(await fs.readFile(script)).digest('hex')!==expected)throw new Error('Generated Codex hook source changed; execution denied');};
    await verify();const rpc=openCodexHookRpc(command,cwd,specs);try{return await establishCodexHookTrust(rpc,cwd,specs,verify);}finally{await rpc.close();}
  };
  const work=tail.then(step,step);tail=work.then(()=>undefined,()=>undefined);return work;
}
