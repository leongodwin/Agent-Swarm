import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {CapabilityService,capabilityConfigSchema,runCapabilityProbe} from './capabilityChecks.ts';
import {deliveryCommands} from './delivery.ts';
const roots:string[]=[],services:CapabilityService[]=[];
afterEach(async()=>{for(const s of services.splice(0))await s.close();vi.restoreAllMocks();for(const p of roots.splice(0))await fs.rm(p,{recursive:true,force:true});});
const target='https://synthetic.crm4.dynamics.com';
const config=capabilityConfigSchema.parse({environmentUrl:target,checks:['authentication','environment','licence','mcp','cli','connector'].map(category=>({id:category,category,remedy:'Reconnect the actual scoped capability',probe:category==='mcp'?{kind:'mcp',url:'http://localhost:1234/mcp',tools:['read']}:category==='cli'?{kind:'cli',executable:'node',minimumVersion:'22.0.0'}:{kind:'http',url:'https://provider.test/status',pointer:['ready'],equals:true}}))});
async function fixture(probe:typeof runCapabilityProbe){const root=await fs.mkdtemp(path.join(os.tmpdir(),'capability-staging-independent-'));roots.push(root);const service=new CapabilityService(root,false,probe);services.push(service);await service.init();await service.configure('repo',config);return {root,service};}
it('waits for all runtime probes, continues required cloud evidence after failure, restores order and never retries',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});const calls:string[]=[],signals=new Map<string,AbortSignal>();
 const {root,service}=await fixture(async(check,_cwd,signal)=>{calls.push(check.id);signals.set(check.id,signal);if(check.id==='mcp')throw new Error('private native failure');if(check.id==='cli'){entered();await gate;}});
 const work=service.check('repo',root,target);await started;expect(calls).toEqual(['mcp','cli']);release();const result=await work;
 expect(result.status).toBe('blocked');expect(result.checks.slice(0,6).map(x=>x.id)).toEqual(config.checks.map(x=>x.id));for(const row of config.checks)expect(calls.filter(id=>id===row.id)).toHaveLength(1);
 expect(calls).toContain('github-auth');expect(calls).toContain('worker-cli');expect(signals.get('mcp')).toBe(signals.get('cli'));expect(signals.get('mcp')).not.toBe(signals.get('authentication'));expect(signals.get('authentication')).toBe(signals.get('connector'));
});
it('cannot dispatch native work from later groups after office cancellation',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const native=vi.spyOn(deliveryCommands,'run').mockRejectedValue(new Error('must not dispatch'));
 const {root,service}=await fixture(async(check,cwd,signal)=>{if(check.id==='cli'){entered();await gate;return;}if(check.id==='mcp')return;return runCapabilityProbe(check,cwd,signal);});
 const pending=service.check('repo',root,target);const rejected=expect(pending).rejects.toThrow();await started;const closing=expect(service.close()).rejects.toThrow();release();await rejected;await closing;services.splice(services.indexOf(service),1);expect(native).not.toHaveBeenCalled();expect(service.view().results).toEqual([]);
});
it('coalesces identical cloud reads within a group but never borrows another check owner signal',async()=>{
 const cloud={kind:'pac-connection' as const,environmentUrl:target,api:'shared_teams',account:'qa@example.test',connectionId:'owned'};
 const custom=structuredClone(config);custom.checks[5].probe=cloud;custom.checks.push({...custom.checks[5],id:'second-connector'});
 const run=vi.spyOn(deliveryCommands,'run').mockResolvedValue('owned  qa@example.test  /providers/Microsoft.PowerApps/apis/shared_teams  Connected');
 const {root,service}=await fixture(async(check,cwd,signal)=>{if(check.probe.kind==='pac-connection')return runCapabilityProbe(check,cwd,signal);});await service.configure('repo',custom);await service.configure('other',custom);
 const results=await Promise.all([service.check('repo',root,target),service.check('other',root,target)]);expect(results.every(r=>r.status==='ready')).toBe(true);expect(run).toHaveBeenCalledTimes(2);expect(run.mock.calls[0][3]).not.toBe(run.mock.calls[1][3]);
});
it.each([false,true])('starts the PAC group only after Azure cloud evidence settles, without retry (cloud failure=%s)',async failed=>{
 const custom=structuredClone(config),identity='11111111-1111-4111-8111-111111111111';
 custom.checks[0].probe={kind:'http',url:target+'/api/data/v9.2/WhoAmI',pointer:['UserId'],equals:identity,azureCli:{tenantId:identity,username:'qa@example.test'}};
 custom.checks[5].probe={kind:'pac-connection',environmentUrl:target,api:'shared_teams',account:'qa@example.test',connectionId:'owned'};custom.checks.push({...custom.checks[5],id:'second-connector'});
 let release!:()=>void,entered!:()=>void;const cloud=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const calls:string[]=[],signals=new Map<string,AbortSignal>();
 const {root,service}=await fixture(async(check,_cwd,signal)=>{calls.push(check.id);signals.set(check.id,signal);if(check.id==='authentication'){entered();await cloud;if(failed)throw Error('Synthetic Azure read failure');}});await service.configure('repo',custom);
 const pending=service.check('repo',root,target);await started;expect(calls.slice(0,2)).toEqual(['mcp','cli']);expect(calls).not.toContain('connector');expect(calls).not.toContain('second-connector');release();const result=await pending;
 expect(result.status).toBe(failed?'blocked':'ready');for(const row of custom.checks)expect(calls.filter(id=>id===row.id)).toHaveLength(1);
 expect(calls.indexOf('connector')).toBeGreaterThan(calls.indexOf('authentication'));expect(signals.get('connector')).toBe(signals.get('second-connector'));expect(signals.get('connector')).not.toBe(signals.get('authentication'));expect(signals.get('connector')).not.toBe(signals.get('mcp'));
 expect(result.checks.slice(0,custom.checks.length).map(x=>x.id)).toEqual(custom.checks.map(x=>x.id));
});
