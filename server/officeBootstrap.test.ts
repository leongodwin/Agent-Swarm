import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { expect, it } from 'vitest';

async function runOffice(home: string, port: number, stopWhenReady = false, inspectReady?:()=>Promise<void>) {
  const child = fork(path.resolve('server/index.ts'), ['--demo'], {
    execArgv: ['--import', 'tsx'], silent: true,
    env: { ...process.env, SWARM_HOME: home, SWARM_LEASE_ROOT: path.join(home, 'leases'), SWARM_PORT: String(port), SWARM_LAUNCHER: '1' },
  });
  let output = '';
  let observationError:unknown;
  const capture = (data: Buffer) => {
    output += data.toString();
    if (stopWhenReady && output.includes('cubefarm on http://localhost:')) {
      stopWhenReady = false;
      void (async()=>{
        try{await inspectReady?.();}catch(error){observationError=error;}
        finally{child.send({ type: 'office:shutdown', restart: false });}
      })();
    }
  };
  child.stdout?.on('data', capture); child.stderr?.on('data', capture);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Isolated office failed to exit: ${output}`)), 25000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    if(observationError)throw observationError;
    return { code, output };
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
}

it('cleans up failed startup without replacing corrupted persisted state', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'office-bootstrap-'));
  try {
    const file = path.join(home, 'demo-state.json'); await fs.writeFile(file, 'corrupted-state');
    const result = await runOffice(home, 0);
    expect(result.code).toBe(1); expect(result.output).toContain('Office startup failed');
    expect(result.output).toContain('stopping office services');
    expect(await fs.readFile(file, 'utf8')).toBe('corrupted-state');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);

it('restores persisted maintenance in actual office bootstraps across two cold starts',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'office-maintenance-bootstrap-'));
  const probe=net.createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  try{
    await fs.writeFile(path.join(home,'demo-maintenance.json'),JSON.stringify({version:1,draining:true}));
    for(let i=0;i<2;i++){
      const result=await runOffice(home,port,true,async()=>{
        const root=`http://127.0.0.1:${port}`;
        const session=await fetch(root+'/api/session');const cookie=session.headers.get('set-cookie')!.split(';')[0];
        const runtime=await fetch(root+'/api/runtime',{headers:{Cookie:cookie}});expect(runtime.status).toBe(200);expect(await runtime.json()).toMatchObject({draining:true});
        const state=await fetch(root+'/api/state',{headers:{Cookie:cookie}});expect((await state.json()).draining).toBe(true);
      });
      expect(result.code).toBe(0);
    }
    expect(JSON.parse(await fs.readFile(path.join(home,'demo-maintenance.json'),'utf8'))).toEqual({version:1,draining:true});
  }finally{await fs.rm(home,{recursive:true,force:true});}
},60000);

it('refuses actual startup with malformed maintenance without repairing away the evidence',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'office-maintenance-corrupt-'));
  try{
    const file=path.join(home,'demo-maintenance.json');await fs.writeFile(file,'{"version":1,"draining":"false"}');
    const result=await runOffice(home,0);expect(result.code).toBe(1);expect(result.output).not.toContain('cubefarm on http://localhost:');
    expect(await fs.readFile(file,'utf8')).toBe('{"version":1,"draining":"false"}');
  }finally{await fs.rm(home,{recursive:true,force:true});}
},30000);

it('handles an occupied listener port through failed-startup cleanup', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'office-listener-'));
  const blocker = net.createServer();
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const port = (blocker.address() as net.AddressInfo).port;
    const result = await runOffice(home, port);
    expect(result.code).toBe(1); expect(result.output).toContain('Office listener failed');
    expect(result.output).toContain('stopping office services');
    expect(JSON.parse(await fs.readFile(path.join(home, 'demo-state.json'), 'utf8')).version).toBe(2);
  } finally {
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    await fs.rm(home, { recursive: true, force: true });
  }
}, 30000);

it('completes launcher-requested quit with successful status and persisted state', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'office-quit-'));
  try {
    const result = await runOffice(home, 0, true);
    expect(result.code).toBe(0); expect(result.output).toContain('stop: stopping office services');
    expect(JSON.parse(await fs.readFile(path.join(home, 'demo-state.json'), 'utf8')).version).toBe(2);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}, 30000);
