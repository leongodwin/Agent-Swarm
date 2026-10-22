import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {CapabilityService,capabilityConfigSchema,runCapabilityProbe} from './capabilityChecks.ts';
const roots:string[]=[],services:CapabilityService[]=[];
afterEach(async()=>{for(const service of services.splice(0))await service.close();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const target='https://synthetic.crm4.dynamics.com';
const config=capabilityConfigSchema.parse({environmentUrl:target,checks:['authentication','environment','licence','mcp','cli','connector'].map(category=>({id:category,category,remedy:'Reconnect the verified capability',probe:category==='mcp'?{kind:'mcp',url:'http://localhost:1234/mcp',tools:['read']}:category==='cli'?{kind:'cli',executable:'node',minimumVersion:'22.0.0'}:{kind:'http',url:'https://provider.test/status',pointer:['ready'],equals:true}}))});
async function fixture(probe:typeof runCapabilityProbe){const root=await fs.mkdtemp(path.join(os.tmpdir(),'capability-diagnostics-independent-'));roots.push(root);const service=new CapabilityService(root,false,probe);services.push(service);await service.init();await service.configure('repo',config);return {root,service};}
it('publishes only bounded stage/classification diagnostics, never raw provider secrets',async()=>{
 const secret='Bearer VERY_PRIVATE_TOKEN user-secret@example.test response-body-password';
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error(secret);}));
 const {root,service}=await fixture(async(check,cwd,signal)=>{if(check.id==='authentication')return runCapabilityProbe(check,cwd,signal);});
 const result=await service.check('repo',root,target);expect(result.status).toBe('blocked');
 expect(result.checks.find(row=>row.id==='authentication')?.diagnostics).toMatchObject({stage:'http-request',failure:'provider'});
 expect(JSON.stringify(result)).not.toContain(secret);expect(await fs.readFile(path.join(root,'capabilities.json'),'utf8')).not.toContain('VERY_PRIVATE_TOKEN');
});
it('anchors readiness lifetime to batch start instead of later probe completion',async()=>{
 vi.useFakeTimers({toFake:['Date']});const start=Date.parse('2026-10-16T12:00:00Z');vi.setSystemTime(start);
 const {root,service}=await fixture(async check=>{if(check.id==='mcp')vi.setSystemTime(start+14900);if(check.id==='github-auth')vi.setSystemTime(start+29800);if(check.id==='worker-cli')vi.setSystemTime(start+44700);});
 const result=await service.check('repo',root,target);expect(result.status).toBe('ready');expect(Date.parse(result.checkedAt)).toBe(start);expect(Date.parse(result.expiresAt)).toBe(start+60000);
 vi.setSystemTime(start+60001);expect(service.view().results[0].status).toBe('blocked');
});
it.each(['deadline','cancelled'] as const)('classifies actual %s abort with fake timers without confusing provider errors',async mode=>{
 vi.useFakeTimers();const controller=new AbortController();
 vi.stubGlobal('fetch',vi.fn(async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('PRIVATE transport body')),{once:true}))));
 const check=config.checks[0];const result=runCapabilityProbe(check,'.',controller.signal);const caught=result.catch(error=>error);
 setTimeout(()=>controller.abort(new DOMException('private reason',mode==='deadline'?'TimeoutError':'AbortError')),10);await vi.advanceTimersByTimeAsync(10);
 expect(await caught).toMatchObject({stage:'http-request',failure:mode});
});
it('rejects a transport that returns a successful body after its caller was cancelled',async()=>{
 const controller=new AbortController();vi.stubGlobal('fetch',vi.fn(async()=>{controller.abort();return {ok:true,text:async()=>'{"ready":true}'};}));
 await expect(runCapabilityProbe(config.checks[0],'.',controller.signal)).rejects.toMatchObject({failure:'cancelled'});
});
it('never publishes a ready decision for configuration changed while a probe was pending',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const {root,service}=await fixture(async check=>{if(check.id==='authentication'){entered();await gate;}});
 const pending=service.check('repo',root,target);await started;const next=structuredClone(config);next.checks[0].remedy='Recheck the newly reviewed target identity';await service.configure('repo',next);release();
 const result=await pending;expect(result.status).toBe('blocked');expect(result.checks.some(row=>row.id==='configuration-changed'&&!row.passed)).toBe(true);expect(service.view().results[0].status).toBe('blocked');
});
it('does not wake the coordinator solely because equivalent probe timings changed',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse('2026-10-16T12:00:00Z'));let step=1;
 const {root,service}=await fixture(async()=>{vi.setSystemTime(Date.now()+step);});const changed=vi.fn();service.onChange=changed;
 const first=await service.check('repo',root,target);expect(first.status).toBe('ready');expect(changed).toHaveBeenCalledTimes(1);
 step=5;const second=await service.check('repo',root,target,'git',true);expect(second.status).toBe('ready');expect(second.checks[0].diagnostics?.elapsedMs).not.toBe(first.checks[0].diagnostics?.elapsedMs);expect(changed).toHaveBeenCalledTimes(1);
});
