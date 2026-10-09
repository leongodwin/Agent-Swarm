import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeEnvironment, createTenancyService, parsePacProfiles, type TenancyRunner } from './tenancy.ts';
import { loginSchema, parseBody, selectSchema } from './requestSchemas.ts';

const profiles = '[1] * UNIVERSAL Dev Sandbox https://org.crm.dynamics.com/ user@example.com Public User';
const services: ReturnType<typeof createTenancyService>[] = [];
afterEach(() => { for (const service of services.splice(0)) service.close(); vi.useRealTimers(); });
function make(runner: TenancyRunner, demo = false) { const service = createTenancyService(demo, runner); services.push(service); return service; }
function runner() {
  let output: (text: string) => void = () => {};
  let ended: (error?: string) => void = () => {};
  const stop = vi.fn();
  const run = vi.fn(async () => profiles);
  const start = vi.fn((_args: string[], write: typeof output, finish: typeof ended) => { output = write; ended = finish; return stop; });
  return { run, start, stop, output: (text: string) => output(text), ended: (error?: string) => ended(error) };
}
describe('Tenancy service', () => {
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
});
