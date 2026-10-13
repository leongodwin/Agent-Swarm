import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeEnvironment, createTenancyService, parsePacProfiles, resolveTenancyCommand, type TenancyRunner } from './tenancy.ts';
import { loginSchema, parseBody, selectSchema } from './requestSchemas.ts';

const profiles = '[1] * UNIVERSAL Dev Sandbox https://org.crm.dynamics.com/ user@example.com Public User';
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
  const run = vi.fn<TenancyRunner['run']>(async () => profiles);
  const start = vi.fn((_args: string[], write: typeof output, finish: typeof ended) => { output = write; ended = finish; return stop; });
  return { run, start, stop, output: (text: string) => output(text), ended: (error?: string) => ended(error) };
}
describe('Tenancy service', () => {
  it('defaults to interactive sign-in and only requests device code explicitly', () => {
    const r = runner(); const service = make(r);
    service.login({ interactive: true });
    expect(r.start.mock.calls[0][0]).not.toContain('--deviceCode');
    r.ended(); const job = service.login({ interactive: true, authMethod: 'device-code' });
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
  it('streams device instructions while pending and only completes after successful exit', () => {
    const r = runner(); const service = make(r); const job = service.login({ interactive: true });
    r.output('Go to https://microsoft.com/devicelogin and enter ABCD');
    expect(service.loginStatus(job.id)).toMatchObject({ status: 'pending', ok: false });
    expect(service.loginStatus(job.id).message).toContain('ABCD');
    r.ended(); expect(service.loginStatus(job.id)).toMatchObject({ status: 'completed', ok: true });
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
    r.ended();resolve(profiles);expect(await old).toMatchObject({status:'stale',isReal:false});expect(service.loginStatus(job.id).status).toBe('completed');
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
