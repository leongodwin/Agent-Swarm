import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), resolve: vi.fn(), unwrap: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: native.spawn, execFile: native.execFile }));
vi.mock('./clis.ts', () => ({ resolveCommand: native.resolve, unwrapCmdShim: native.unwrap }));
import { createTenancyService, resolveTenancyCommand } from './tenancy.ts';
import {TenancyMutationStore} from './tenancyMutation.ts';

const homes: string[] = [], services: ReturnType<typeof createTenancyService>[] = [];
function home() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-native-qa-')); homes.push(root); return root; }
beforeEach(() => { vi.stubEnv('LOCALAPPDATA', home()); native.spawn.mockReset(); native.execFile.mockReset(); native.resolve.mockReset().mockReturnValue('synthetic-cli'); native.unwrap.mockReset(); });
afterEach(() => { for (const service of services.splice(0)) service.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of homes.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 8 }); });
const profiles = '[1] * UNIVERSAL Synthetic https://org.crm.dynamics.com/ user@example.test Public User';
const identity = 'Org ID: 11111111-1111-4111-8111-111111111111\nUser ID: 22222222-2222-4222-8222-222222222222\nOrg URL: https://org.crm.dynamics.com/\nEnvironment ID: 33333333-3333-4333-8333-333333333333\nUser Email: user@example.test';
function make() { const service = createTenancyService(false, undefined, home()); services.push(service); return service; }
function child(pid: number | undefined) { const value = Object.assign(new EventEmitter(), { pid, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() }); native.spawn.mockReturnValue(value); return value; }
it('rejects absent and unsafe shell shims while preserving known native launcher arguments', () => {
  native.resolve.mockReturnValue(null); expect(() => resolveTenancyCommand('missing')).toThrow('not installed');
  const root = home(), shim = path.join(root, 'synthetic.cmd'); fs.writeFileSync(shim, 'unsupported shell wrapper'); native.resolve.mockReturnValue(shim);
  expect(() => resolveTenancyCommand('pac')).toThrow('Cannot safely resolve');
  fs.writeFileSync(shim, '"%~dp0native.exe" %*'); expect(resolveTenancyCommand('pac')).toEqual({ file: path.join(root, 'native.exe'), args: [] });
  fs.writeFileSync(shim, 'safe node shim'); native.unwrap.mockReturnValue({ file: process.execPath, args: ['synthetic-entry.js'] }); expect(resolveTenancyCommand('dataverse')).toEqual({ file: process.execPath, args: ['synthetic-entry.js'] });
});
it('preserves Azure MSI module flags and uses installed PAC launcher only on Windows', () => {
  const root = home(), bin = path.join(root, 'bin'); fs.mkdirSync(bin); const shim = path.join(bin, 'az.cmd'); fs.writeFileSync(shim, 'python -IBm azure.cli %*'); fs.writeFileSync(path.join(root, 'python.exe'), 'synthetic'); native.resolve.mockReturnValue(shim);
  expect(resolveTenancyCommand('az')).toEqual({ file: path.join(root, 'python.exe'), args: ['-IBm', 'azure.cli'] });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'win32' }); vi.stubEnv('LOCALAPPDATA', root);
  try { const launcher = path.join(root, 'Microsoft', 'PowerAppsCLI', 'pac.launcher.exe'); fs.mkdirSync(path.dirname(launcher), { recursive: true }); fs.writeFileSync(launcher, 'synthetic'); expect(resolveTenancyCommand('pac')).toEqual({ file: launcher, args: [] }); }
  finally { Object.defineProperty(process, 'platform', descriptor); }
});
it('returns disconnected identity for discovery command and resolution failures without provider leakage', async () => {
  native.execFile.mockImplementation((_file, _args, _opts, cb) => cb(new Error('private provider detail'), ''));
  const first = make(); expect(await first.info()).toMatchObject({ isReal: false, status: 'disconnected' });
  expect(native.execFile).toHaveBeenCalledWith('synthetic-cli', ['auth', 'list'], expect.objectContaining({ windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }), expect.any(Function));
  native.resolve.mockReturnValue(null); expect(await make().info()).toMatchObject({ isReal: false, status: 'disconnected' });
});
it('confirms native login through separate account observations and ignores subsequent terminal events', async () => {
  native.execFile.mockImplementation((_file, args, _opts, cb) => cb(null, args[0] === 'org' ? identity : profiles));
  const process = child(12345), service = make(), job = service.login({ interactive: true, environmentUrl: 'https://org.crm.dynamics.com', name: 'Synthetic qa' });
  process.stdout.emit('data', Buffer.from('Synthetic instructions')); process.stderr.emit('data', Buffer.from('\nWaiting for sign-in')); expect(service.loginStatus(job.id).message).toContain('Waiting');
  process.emit('close', 0); await vi.waitFor(() => expect(service.loginStatus(job.id).status).toBe('completed'));
  expect(service.loginStatus(job.id).observation).toMatchObject({ username: 'user@example.test', environmentUrl: 'https://org.crm.dynamics.com' });
  process.emit('error', new Error('late')); process.emit('close', 1); expect(service.loginStatus(job.id).status).toBe('completed'); await service.shutdown();
});
it.each([undefined, 12345])('does not accept a native process error with pid %s before confirmed exit', async pid => {
  const process = child(pid), service = make(), job = service.login({ interactive: true }); process.emit('error', new Error('private native failure'));
  if (pid !== undefined) { expect(service.loginStatus(job.id)).toMatchObject({ status: 'pending', nativeCleanup: 'awaiting-exit' }); expect(service.loginStatus(job.id).message).toContain('waiting for confirmed native exit'); process.emit('close', 0); }
  expect(service.loginStatus(job.id)).toMatchObject({ status: 'failed', nativeCleanup: 'exited', ok: false }); expect(service.loginStatus(job.id).message).not.toContain('private native'); await service.shutdown();
});
it('sends stop to the native root, retains the cancelled reservation until exit and then settles shutdown', async () => {
  const process = child(12345), service = make(), job = service.login({ interactive: true }); service.cancelLogin(job.id); if(globalThis.process.platform==='win32'){expect(native.execFile).toHaveBeenCalledWith('taskkill',['/PID','12345','/T','/F'],{windowsHide:true},expect.any(Function));expect(process.kill).not.toHaveBeenCalled();}else expect(process.kill).toHaveBeenCalledOnce(); expect(service.activity().awaitingNativeExit).toBe(1);
  const stopped = service.shutdown(); process.emit('close', 1); await stopped; expect(service.activity().awaitingNativeExit).toBe(0); expect(service.loginStatus(job.id).status).toBe('cancelled');
});
it('retains Windows authentication ownership after failed process-tree cancellation until native exit',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis.process,'platform')!;Object.defineProperty(globalThis.process,'platform',{value:'win32'});
  try{const proc=child(12345),service=make(),job=service.login({interactive:true});native.execFile.mockImplementation((_file,_args,_opts,cb)=>cb(new Error('synthetic taskkill failure')));service.cancelLogin(job.id);expect(service.loginStatus(job.id).message).toContain('waiting for confirmed native exit');expect(service.activity().awaitingNativeExit).toBe(1);let settled=false;const stopped=service.shutdown().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);proc.emit('close',1);await stopped;expect(service.activity().awaitingNativeExit).toBe(0);expect(service.loginStatus(job.id).status).toBe('cancelled');}
  finally{Object.defineProperty(globalThis.process,'platform',descriptor);}
});
it('quarantines displaced authentication acknowledgement and never certifies its native success', async () => {
  const root = home(), service = createTenancyService(false, undefined, root); services.push(service); const process = child(12345), job = service.login({ interactive: true });
  const file = path.join(root, 'tenancy-mutation.json'), state = JSON.parse(fs.readFileSync(file, 'utf8')); state.active.owner = '22222222-2222-4222-8222-222222222222'; fs.writeFileSync(file, JSON.stringify(state));
  process.emit('close', 0); expect(service.loginStatus(job.id)).toMatchObject({ status: 'failed', ok: false, nativeCleanup: 'exited' }); expect(service.loginStatus(job.id).message).toContain('reconciliation');
  expect(service.activity().profileMutation).toMatchObject({ status: 'unavailable', quarantined: true }); await expect(service.shutdown()).rejects.toThrow('ownership acknowledgement failed');
});
it('fails profile selection when its durable acknowledgement is displaced after the native command returns', async () => {
  const root = home(), service = createTenancyService(false, undefined, root); services.push(service);
  native.execFile.mockImplementation((_file, args, _opts, cb) => {
    if (args[1] === 'select') { const file = path.join(root, 'tenancy-mutation.json'), state = JSON.parse(fs.readFileSync(file, 'utf8')); state.active.owner = '22222222-2222-4222-8222-222222222222'; fs.writeFileSync(file, JSON.stringify(state)); }
    cb(null, args[1] === 'list' ? profiles : '');
  });
  await expect(service.select(1)).rejects.toThrow('acknowledgement failed'); expect(service.activity().profileMutation?.status).toBe('unavailable'); await expect(service.shutdown()).rejects.toThrow('acknowledgement failed');
});
it('retains an unacknowledged launch intent after native startup throws rather than treating absence of a pid as success', async () => {
  native.spawn.mockImplementation(() => { throw new Error('private native startup failure'); }); const service = make(), job = service.login({ interactive: true });
  expect(job).toMatchObject({ status: 'failed', nativeCleanup: 'exited', ok: false }); expect(job.message).not.toContain('private native'); expect(service.activity().profileMutation).toMatchObject({ status: 'pending', quarantined: true }); await expect(service.shutdown()).rejects.toThrow('requires reconciliation');
});
it('bounds demo login history, has no native mutation effects and refuses unknown status or cancellation requests', async () => {
  const service = createTenancyService(true, undefined, home()); services.push(service); const first = service.login({ interactive: true });
  for (let index = 0; index < 20; index++) service.login({ interactive: true });
  expect(() => service.loginStatus(first.id)).toThrow('not found'); expect(() => service.cancelLogin('missing')).toThrow('not found'); expect(service.activity().profileMutation?.status).toBe('clear'); expect(native.spawn).not.toHaveBeenCalled(); expect(native.execFile).not.toHaveBeenCalled(); await service.shutdown();
});
it('holds late closed native cleanup failures until its exit acknowledgement rather than resolving shutdown early', async () => {
  const process = child(12345), service = make(); service.login({ interactive: true }); if(globalThis.process.platform==='win32')native.execFile.mockImplementation(() => {throw new Error('Synthetic stop failed');});else process.kill.mockImplementation(() => { throw new Error('Synthetic stop failed'); });
  const failed = expect(service.shutdown()).rejects.toThrow('cleanup failed'); process.emit('close', 1); await failed; expect(service.activity().awaitingNativeExit).toBe(0);
});
it('marks cached identity stale during an independently reserved profile mutation', async () => {
  const root = home(), service = createTenancyService(false, undefined, root); services.push(service); native.execFile.mockImplementation((_file, _args, _opts, cb) => cb(null, profiles));
  expect(await service.info()).toMatchObject({ status: 'connected', isReal: true });
  const other = new TenancyMutationStore(path.join(root, 'tenancy-mutation.json')); const intent = other.begin('sign-in');
  expect(await service.info()).toMatchObject({ status: 'stale', isReal: false, authenticationBusy: true, environments: [{ index: 1 }] }); expect(native.execFile).toHaveBeenCalledTimes(1);
  other.acknowledge(intent, 'native-authentication-terminal'); await service.shutdown();
});
it.each(['who-result', 'who-error', 'final-profile-result', 'final-profile-error'] as const)('ignores %s verification that returns after shutdown while retaining native command ownership', async mode => {
  let waiting!: (error: Error | null, output: string) => void, lists = 0;
  native.execFile.mockImplementation((_file, args, _opts, cb) => { if (args[0] === 'org') { if (mode.startsWith('who')) waiting = cb; else cb(null, identity); }
    else if (++lists === 2 && mode.startsWith('final-profile')) waiting = cb; else cb(null, profiles); });
  const process = child(12345), service = make(), job = service.login({ interactive: true }); process.emit('close', 0); await vi.waitFor(() => expect(waiting).toBeDefined());
  let settled = false; const stopped = service.shutdown().then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  waiting(mode.endsWith('error') ? new Error('late private provider failure') : null, mode.startsWith('who') ? identity : profiles); await stopped;
  expect(service.loginStatus(job.id)).toMatchObject({ status: 'cancelled', ok: false }); expect(service.loginStatus(job.id).observation).toBeUndefined(); expect(service.activity().nativeCommands).toBe(0);
});
it('rejects invalid native profile indices before consulting or changing accounts and handles an incomplete Azure shim safely', async () => {
  const service = make(); for (const index of [0, -1, 1.5]) await expect(service.select(index)).rejects.toThrow('positive integer'); expect(native.execFile).not.toHaveBeenCalled();
  const root = home(), bin = path.join(root, 'bin'); fs.mkdirSync(bin); const shim = path.join(bin, 'az.cmd'); fs.writeFileSync(shim, 'python -IBm azure.cli %*'); native.resolve.mockReturnValue(shim);
  expect(() => resolveTenancyCommand('az')).toThrow('Cannot safely resolve'); await service.shutdown();
});
