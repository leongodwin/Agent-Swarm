import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeEnvironment, createTenancyService, parsePacProfiles, resolveTenancyCommand, type TenancyRunner } from './tenancy.ts';
import { loginSchema, parseBody, selectSchema } from './requestSchemas.ts';

const orgIdentity='Org ID: 11111111-1111-4111-8111-111111111111\nUser ID: 22222222-2222-4222-8222-222222222222\nOrg URL: https://org.crm.dynamics.com/\nEnvironment ID: 33333333-3333-4333-8333-333333333333\nUser Email: user@example.com';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const profiles = '[1] * UNIVERSAL Dev Sandbox https://org.crm.dynamics.com/ user@example.com Public User';
it.each([
  `${profiles}\n${profiles}`,
  `${profiles}\n[2] * UNIVERSAL Other https://other.crm.dynamics.com/ user@example.com`,
  profiles.replace('[1]','[0]'),profiles.replace('[1]','[9007199254740992]'),
  profiles.replace('https://org.crm.dynamics.com/','https://org.crm.dynamics.com/path'),
  profiles.replace('https://org.crm.dynamics.com/','https://user:secret@org.crm.dynamics.com/'),
  profiles.replace('https://org.crm.dynamics.com/','https://org.crm.dynamics.com/?token=value'),
  profiles.replace('https://org.crm.dynamics.com/','https://org.crm.dynamics.com:444/'),
  profiles+'\n'+'x'.repeat(65536),
])('rejects ambiguous or unsafe PAC discovery %#',output=>{expect(()=>parsePacProfiles(output)).toThrow();});
it('recognizes the active marker only immediately after the profile index',()=>{
  const info=parsePacProfiles(profiles.replace('[1] *','[1]')+' * starred profile label');expect(info.isReal).toBe(false);expect(info.environments[0].active).toBe(false);
});
it('accepts an existing absolute executable without searching PATH', () => {
  expect(resolveTenancyCommand(process.execPath)).toEqual({ file: process.execPath, args: [] });
});
const services: ReturnType<typeof createTenancyService>[] = [];
afterEach(() => { for (const service of services.splice(0)) service.close(); vi.useRealTimers(); });
function make(runner: TenancyRunner, demo = false) { const service = createTenancyService(demo, runner); services.push(service); return service; }
function runner() {
  let output: (text: string) => void = () => {};
  let ended: (error?: string) => void = () => {};
  const stop = vi.fn();
  const run = vi.fn<TenancyRunner['run']>(async (_name,args) => args[0]==='org'?orgIdentity:profiles);
  const start = vi.fn((_args: string[], write: typeof output, finish: typeof ended) => { output = write; ended = finish; return stop; });
  return { run, start, stop, output: (text: string) => output(text), ended: (error?: string) => ended(error) };
}
describe('Tenancy service', () => {
  it.each(['cancel','expiry'] as const)('holds profile changes and discovery after %s until native exit is observed',async mode=>{
    vi.useFakeTimers();const r=runner(),service=make(r),job=service.login({interactive:true});
    if(mode==='cancel')service.cancelLogin(job.id);else vi.advanceTimersByTime(600000);
    expect(service.loginStatus(job.id)).toMatchObject({ok:false,nativeCleanup:'awaiting-exit'});
    expect(()=>service.login({interactive:true})).toThrow('already pending');await expect(service.select(1)).rejects.toThrow('already pending');expect(await service.info()).toMatchObject({isReal:false,status:'disconnected'});expect(r.run).not.toHaveBeenCalled();
    r.ended();expect(service.loginStatus(job.id)).toMatchObject({status:mode==='cancel'?'cancelled':'expired',ok:false,nativeCleanup:'exited'});
    const next=service.login({interactive:true});expect(next.status).toBe('pending');expect(r.start).toHaveBeenCalledTimes(2);
  });
  it('keeps native cleanup held after a stop failure until the exit callback arrives',async()=>{
    const r=runner(),service=make(r),job=service.login({interactive:true});r.stop.mockImplementation(()=>{throw new Error('stop failed');});expect(()=>service.cancelLogin(job.id)).toThrow('stop failed');expect(()=>service.login({interactive:true})).toThrow('already pending');expect(service.loginStatus(job.id).nativeCleanup).toBe('awaiting-exit');r.ended();expect(service.loginStatus(job.id).nativeCleanup).toBe('exited');
  });
  it.each(['no-active','missing-account','wrong-target','who-account','who-target','who-malformed','who-failed','profile-drift'] as const)('refuses sign-in completion for %s verification evidence',async mode=>{
    const r=runner(),service=make(r);let lists=0;
    r.run.mockImplementation(async(_name,args)=>{
      if(args[0]==='org'){
        if(mode==='who-failed')throw new Error('Private provider response');
        return mode==='who-account'?orgIdentity.replace('user@example.com','other@example.com'):mode==='who-target'?orgIdentity.replace('org.crm','other.crm'):mode==='who-malformed'?'Connected successfully':orgIdentity;
      }
      lists++;return mode==='no-active'?profiles.replace('*',''):mode==='missing-account'?profiles.replace('user@example.com',''):mode==='wrong-target'?profiles.replace('org.crm','other.crm'):mode==='profile-drift'&&lists===2?profiles.replace('[1]','[2]'):profiles;
    });
    const job=service.login({interactive:true,environmentUrl:'https://org.crm.dynamics.com/'});r.ended();await flush();
    expect(service.loginStatus(job.id)).toMatchObject({status:'failed',ok:false});expect(service.loginStatus(job.id).observation).toBeUndefined();
    expect(service.loginStatus(job.id).message).not.toContain('Private provider response');
  });
  it('holds profile changes while verifying, ignores duplicate callbacks and copies confirmed observations',async()=>{
    const r=runner(),service=make(r);let resolve!:(text:string)=>void;r.run.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const input={interactive:true,environmentUrl:'https://org.crm.dynamics.com/'},job=service.login(input);input.environmentUrl='https://other.crm.dynamics.com/';r.ended();r.ended('late duplicate');r.output('late native output');
    expect(service.loginStatus(job.id)).toMatchObject({status:'pending',phase:'verifying',ok:false});expect(service.loginStatus(job.id).message).toContain('Verifying');
    expect(()=>service.login({interactive:true})).toThrow('already pending');await expect(service.select(1)).rejects.toThrow('already pending');
    resolve(profiles);await flush();const observed=service.loginStatus(job.id);expect(observed.status).toBe('completed');observed.observation!.username='forged@example.com';expect(service.loginStatus(job.id).observation!.username).toBe('user@example.com');
    expect(r.run.mock.calls.map(([,args])=>args)).toEqual([['auth','list'],['org','who','--environment','https://org.crm.dynamics.com'],['auth','list']]);
  });
  it.each(['cancel','close','expiry'] as const)('does not accept late native confirmation after %s',async mode=>{
    vi.useFakeTimers();const r=runner(),service=make(r);let resolve!:(text:string)=>void;r.run.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const job=service.login({interactive:true});r.ended();if(mode==='cancel')service.cancelLogin(job.id);else if(mode==='close')service.close();else vi.advanceTimersByTime(600000);
    resolve(profiles);await flush();expect(service.loginStatus(job.id)).toMatchObject({status:mode==='expiry'?'expired':'cancelled',ok:false});expect(service.loginStatus(job.id).observation).toBeUndefined();expect(r.run).toHaveBeenCalledTimes(1);
  });
  it('does not accept the previous login observation after a new authentication generation begins',async()=>{
    const r=runner(),service=make(r);let resolve!:(text:string)=>void;r.run.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const old=service.login({interactive:true});r.ended();service.cancelLogin(old.id);const current=service.login({interactive:true});resolve(profiles);await flush();expect(service.loginStatus(old.id).status).toBe('cancelled');expect(service.loginStatus(current.id)).toMatchObject({status:'pending',phase:'authenticating',ok:false});
  });
  it.each(['Error: profile creation denied','AADSTS53003: access blocked'])('rejects PAC-reported failure despite a zero exit and preserves the failure latch: %s',async failure=>{
    const r=runner(),service=make(r),job=service.login({interactive:true});r.output(failure+'\n'+'x'.repeat(20000));r.ended();await flush();expect(service.loginStatus(job.id)).toMatchObject({status:'failed',ok:false});expect(r.run).not.toHaveBeenCalled();
  });
  it.each(['https://user:secret@org.crm.dynamics.com/','https://org.crm.dynamics.com/path','https://org.crm.dynamics.com/?token=secret','https://org.crm.dynamics.com/#fragment','https://org.crm.dynamics.com:444/'])('refuses unsafe sign-in scope before spawning: %s',environmentUrl=>{
    const r=runner(),service=make(r);expect(()=>service.login({interactive:true,environmentUrl})).toThrow('organization root');expect(()=>parseBody(loginSchema,{interactive:true,environmentUrl})).toThrow('organization root');expect(r.start).not.toHaveBeenCalled();
  });
  it('confirms selected account and environment with a fresh profile read',async()=>{
    const r=runner(),service=make(r);await service.info();await expect(service.select(1)).resolves.toMatchObject({ok:true});
    expect(r.run.mock.calls.map(([,args])=>args)).toEqual([['auth','list'],['auth','select','--index','1'],['auth','list']]);
  });
  it.each(['other-index','other-account','other-environment','no-active','malformed'])('does not certify profile selection when post-selection discovery shows %s',async mode=>{
    const r=runner(),service=make(r);await service.info();const confirmation=mode==='other-index'?profiles.replace('[1]','[2]'):mode==='other-account'?profiles.replace('user@example.com','other@example.com'):mode==='other-environment'?profiles.replace('org.crm','other.crm'):mode==='no-active'?profiles.replace('*',''):profiles+'\n'+profiles;
    r.run.mockImplementation(async(_name,args)=>args.includes('select')?'Error: selection denied':confirmation);
    await expect(service.select(1)).rejects.toThrow();expect((await service.info()).isReal).toBe(mode!=='no-active'&&mode!=='malformed');
  });
  it('defaults to interactive sign-in and only requests device code explicitly', async () => {
    const r = runner(); const service = make(r);
    service.login({ interactive: true });
    expect(r.start.mock.calls[0][0]).not.toContain('--deviceCode');
    r.ended(); await flush();const job = service.login({ interactive: true, authMethod: 'device-code' });
    expect(r.start.mock.calls[1][0]).toContain('--deviceCode');
    r.output('AADSTS53003: device code blocked by Conditional Access'); r.ended('failed');
    expect(service.loginStatus(job.id).message).toContain('Conditional Access');
  });
  it('uses PAC profile identity and returns unknown tenant metadata without invention', () => {
    const info = parsePacProfiles(profiles);
    expect(info.user).toBe('user@example.com'); expect(info.tenantId).toBe(''); expect(info.tenantDomain).toBe('');
    expect(activeEnvironment(info)?.environmentUrl).toBe('https://org.crm.dynamics.com/');
    expect(activeEnvironment(parsePacProfiles('no profiles'))).toBeUndefined();
  });
  it('coalesces asynchronous discovery and reports disconnected CLI failures', async () => {
    const r = runner(); r.run.mockRejectedValue(new Error('offline'));
    const service = make(r);
    const results = await Promise.all([service.info(), service.info(), service.info()]);
    expect(r.run).toHaveBeenCalledTimes(1); expect(results[0].isReal).toBe(false); expect(results[0].environments).toEqual([]);
  });
  it('never invokes real commands in demo discovery, select, or login', async () => {
    const r = runner(); const service = make(r, true);
    expect((await service.info()).isReal).toBe(false);
    await service.select(1);
    expect(service.login({ interactive: true }).status).toBe('completed');
    expect(r.run).not.toHaveBeenCalled(); expect(r.start).not.toHaveBeenCalled();
  });
  it('passes shell metacharacters as literal arguments and never returns credential output', () => {
    const r = runner(); const service = make(r);
    const secret = 'secret$(`hello`)&%PATH%';
    const input = parseBody(loginSchema, { name: 'x" & echo test', interactive: false,
      applicationId: '00000000-0000-4000-8000-000000000001', tenantId: 'example.com', clientSecret: secret });
    const job = service.login(input);
    expect(r.start.mock.calls[0][0]).toContain('x" & echo test'); expect(r.start.mock.calls[0][0]).toContain(secret);
    r.output(secret.slice(0, 8)); r.output(secret.slice(8));
    expect(service.loginStatus(job.id).message).not.toContain('secret');
    r.ended('command included credentials');
    expect(service.loginStatus(job.id).status).toBe('failed'); expect(service.loginStatus(job.id).message).not.toContain(secret);
  });
  it('streams instructions then verifies the native profile and organization after successful exit', async () => {
    const r = runner(); const service = make(r); const job = service.login({ interactive: true });
    r.output('Go to https://microsoft.com/devicelogin and enter ABCD');
    expect(service.loginStatus(job.id)).toMatchObject({ status: 'pending', ok: false });
    expect(service.loginStatus(job.id).message).toContain('ABCD');
    r.ended();expect(service.loginStatus(job.id)).toMatchObject({status:'pending',phase:'verifying',ok:false});await flush();expect(service.loginStatus(job.id)).toMatchObject({ status: 'completed', ok: true,observation:{scope:'pac-profile-and-organization',username:'user@example.com'} });
  });
  it('expires or cancels pending login without falsely authenticating', () => {
    vi.useFakeTimers(); const r = runner(); const service = make(r); const job = service.login({ interactive: true });
    vi.advanceTimersByTime(600_000); r.ended();
    expect(service.loginStatus(job.id)).toMatchObject({ status: 'expired', ok: false }); expect(r.stop).toHaveBeenCalledOnce();
    const next = service.login({ interactive: true }); service.cancelLogin(next.id); r.ended();
    expect(service.loginStatus(next.id).status).toBe('cancelled');
  });
  it('rejects missing credentials, fractional indices, and absent profiles', async () => {
    expect(() => parseBody(loginSchema, { interactive: false, clientSecret: 'secret' })).toThrow('requires tenant');
    expect(() => parseBody(selectSchema, { index: 1.5 })).toThrow();
    await expect(make(runner()).select(2)).rejects.toThrow('not found');
  });
  it('awaits expired discovery and exposes failed refreshes as stale rather than connected',async()=>{
    vi.useFakeTimers();const r=runner(),service=make(r);await service.info();vi.advanceTimersByTime(20001);
    let reject!:(error:Error)=>void;r.run.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
    let finished=false;const first=service.info().then(value=>{finished=true;return value;}),second=service.info();await Promise.resolve();
    expect(finished).toBe(false);expect(r.run).toHaveBeenCalledTimes(2);reject(new Error('provider offline'));
    expect(await first).toMatchObject({status:'stale',isReal:false});expect(await second).toMatchObject({status:'stale',isReal:false});
    await expect(service.select(1)).rejects.toThrow('stale');
  });
  it('invalidates discovery across an authentication change without caching the old account',async()=>{
    const r=runner();let resolve!:(text:string)=>void;r.run.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const service=make(r);
    const old=service.info();await Promise.resolve();const job=service.login({interactive:true});expect((await service.info()).status).toBe('disconnected');
    r.ended();resolve(profiles);expect(await old).toMatchObject({status:'stale',isReal:false});await flush();expect(service.loginStatus(job.id).status).toBe('completed');
    r.run.mockResolvedValue('[1] * UNIVERSAL New https://new.crm.dynamics.com/ new@example.com Public User');
    expect(await service.info()).toMatchObject({status:'connected',user:'new@example.com'});
  });
  it('closes login and selection admission and ignores late completion/discovery after shutdown',async()=>{
    vi.useFakeTimers();const r=runner(),service=make(r);const job=service.login({interactive:true});service.close();service.close();r.ended();
    expect(service.loginStatus(job.id)).toMatchObject({status:'cancelled',ok:false});expect(r.stop).toHaveBeenCalledOnce();
    expect(()=>service.login({interactive:true})).toThrow('closed');await expect(service.select(1)).rejects.toThrow('closed');
    expect(await service.info()).toMatchObject({status:'disconnected',isReal:false,environments:[]});vi.advanceTimersByTime(600001);expect(r.stop).toHaveBeenCalledOnce();
    let resolve!:(text:string)=>void;const pending=runner();pending.run.mockImplementation(()=>new Promise(done=>{resolve=done;}));const other=make(pending);
    const discovery=other.info();await Promise.resolve();other.close();resolve(profiles);expect(await discovery).toMatchObject({status:'disconnected',isReal:false});
  });
  it('cannot start profile selection if shutdown occurs during prerequisite discovery',async()=>{
    const r=runner();let resolve!:(text:string)=>void;r.run.mockImplementation(()=>new Promise(done=>{resolve=done;}));const service=make(r);
    const selection=service.select(1);const denied=expect(selection).rejects.toThrow('closed');await Promise.resolve();service.close();resolve(profiles);await denied;
    expect(r.run).toHaveBeenCalledExactlyOnceWith('pac',['auth','list']);
  });
  it('serializes native profile changes and never reports success for a selection finishing after closure',async()=>{
    const r=runner(),service=make(r);await service.info();let resolve!:(text:string)=>void;
    r.run.mockImplementation((_name,args)=>args.includes('select')?new Promise(done=>{resolve=done;}):Promise.resolve(profiles));
    const selection=service.select(1);const denied=expect(selection).rejects.toThrow('closed');await Promise.resolve();
    expect(()=>service.login({interactive:true})).toThrow('already pending');await expect(service.select(1)).rejects.toThrow('already pending');
    expect((await service.info()).status).toBe('disconnected');service.close();resolve('selected');await denied;
    expect(r.run.mock.calls.filter(([,args])=>args.includes('select'))).toHaveLength(1);expect(r.start).not.toHaveBeenCalled();
  });
  it('stops a late launch handle when shutdown happens synchronously inside native startup',()=>{
    const r=runner();let service:ReturnType<typeof createTenancyService>;r.start.mockImplementation(()=>{service.close();return r.stop;});service=make(r);
    const job=service.login({interactive:true});expect(job).toMatchObject({status:'cancelled',ok:false});expect(r.stop).toHaveBeenCalledOnce();
  });
  it('does not reuse cached discovery across clock rollback and retains admission closure on cleanup failure',async()=>{
    vi.useFakeTimers();const r=runner(),service=make(r);await service.info();vi.setSystemTime(Date.now()-1000);await service.info();expect(r.run).toHaveBeenCalledTimes(2);
    r.stop.mockImplementation(()=>{throw new Error('private cleanup detail');});const job=service.login({interactive:true});expect(()=>service.close()).toThrow('cleanup failed');
    expect(service.loginStatus(job.id).status).toBe('cancelled');expect(()=>service.login({interactive:true})).toThrow('closed');
  });
});
