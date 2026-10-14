import { describe, expect, it,vi } from 'vitest';
import { AgentTerminal } from './terminal.ts';
import { EventEmitter,once } from 'node:events';
import { WebSocket,WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MAX_OFFICE_WS_PAYLOAD} from './webSocketLimits.ts';

function viewer(){
  const messages:any[]=[];
  const ws=Object.assign(new EventEmitter(),{OPEN:1,readyState:1,bufferedAmount:0,send:vi.fn((json:string,callback?:(error?:Error)=>void)=>{messages.push(JSON.parse(json));callback?.();}),close:vi.fn()});
  return {ws,messages};
}

describe('AgentTerminal', () => {
  it('ignores malformed websocket messages and accepts valid input', async () => {
    const t = new AgentTerminal();
    const got: string[] = [];
    t.bind({ write: (data) => got.push(data), resize: () => {} });
    const fake = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send: () => {}, close: () => {} });
    t.attach(fake as unknown as WebSocket);
    for (const data of ['null', '1', '"text"', '[]', 'false', '{', '{"t":"resize","cols":null,"rows":"bad"}', '{"t":"input","data":4}']) {
      expect(() => fake.emit('message', data)).not.toThrow();
    }
    expect(got).toEqual([]);
    fake.emit('message', '{"t":"input","data":"hello"}'); expect(got).toEqual(['hello']);
    await t.flush(); t.dispose();
  });
  it('safely overlaps periodic and shutdown saves', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-terminal-save-'));
    const t = new AgentTerminal(); const file = path.join(dir, 'terminal');
    try {
      t.write('first\r\n'); const first = t.save(file);
      t.write('latest\r\n'); const last = t.save(file);
      await Promise.all([first, last]);
      expect(await fs.readFile(file, 'utf8')).toContain('latest'); expect(t.dirty).toBe(false);
      expect(await fs.readdir(dir)).toEqual(['terminal']);
    } finally { t.dispose(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('keeps what was printed, so a late viewer sees the same screen', async () => {
    const t = new AgentTerminal();
    t.write('\x1b[32mhello\x1b[0m world\r\n');
    await t.flush();
    expect(t.screen()).toContain('hello world');
    const again = new AgentTerminal();
    again.write(t.snapshot());
    await again.flush();
    expect(again.screen()).toContain('hello world');
    t.dispose();
    again.dispose();
  });

  it('sends keystrokes and sizes to the running CLI, within sane bounds', () => {
    const t = new AgentTerminal();
    const got: string[] = [];
    t.bind({ write: (d) => got.push(d), resize: (c, r) => got.push(`${c}x${r}`) });
    expect(got).toEqual([`${t.cols}x${t.rows}`]);
    t.resize(5000, 1);
    expect([t.cols, t.rows]).toEqual([400, 5]);
    expect(got.at(-1)).toBe('400x5');
    t.bind(null);
    expect(t.live).toBe(false);
    t.dispose();
  });

  it('discards an overflowing initial queue by UTF-8 bytes and resynchronizes from parsed output',async()=>{
    const t=new AgentTerminal(),{ws,messages}=viewer();let barrier!:()=>void;
    const mirror=(t as any).term;
    vi.spyOn(mirror,'write').mockImplementationOnce((...args:unknown[])=>{barrier=args[1] as ()=>void;});
    try{
      t.attach(ws as unknown as WebSocket);
      // 1.5m characters fit below a character-count bound but exceed 4 MiB as UTF-8.
      t.write(`${'漢'.repeat(1500000)}\r\nlast output\r\n`);
      const state=(t as any).viewers.get(ws);
      expect(state.stale).toBe(true);expect(state.queued===null).toBe(true);expect(state.queuedBytes).toBe(0);
      await t.flush();
      // Recovery must not race the held initial snapshot, even after its timer fires.
      await new Promise(resolve=>setTimeout(resolve,1150));expect(messages).toEqual([]);
      barrier();expect(messages).toEqual([]);
      await vi.waitFor(()=>expect(messages).toHaveLength(1),{timeout:5000,interval:50});await t.flush();
      expect(messages).toHaveLength(1);expect(messages[0].t).toBe('snapshot');expect(messages[0].data).toContain('last output');
      expect(messages.some(message=>message.t==='data')).toBe(false);
    }finally{t.dispose();}
  });

  it('recovers a slow viewer without replaying its discarded backlog',async()=>{
    const t=new AgentTerminal(),{ws,messages}=viewer();
    try{
      t.attach(ws as unknown as WebSocket);await t.flush();messages.length=0;
      ws.bufferedAmount=5*1024*1024;t.write('discarded live frame\r\n');await t.flush();expect(messages).toEqual([]);
      await new Promise(resolve=>setTimeout(resolve,1100));expect(messages).toEqual([]);
      ws.bufferedAmount=0;t.write('latest visible line\r\n');await t.flush();
      await new Promise(resolve=>setTimeout(resolve,1100));await t.flush();
      expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({t:'snapshot',live:false});expect(messages[0].data).toContain('latest visible line');
      t.write('normal output');await t.flush();expect(messages.at(-1)).toEqual({t:'data',data:'normal output'});
    }finally{t.dispose();}
  });

  it.each(['throw','callback'] as const)('isolates a socket %s failure and prevents later keystrokes',async mode=>{
    const t=new AgentTerminal(),{ws}=viewer(),keys:string[]=[];
    try{
      t.bind({write:text=>keys.push(text),resize:()=>{}});t.attach(ws as unknown as WebSocket);await t.flush();
      ws.send.mockImplementation((_json,callback)=>{if(mode==='throw')throw new Error('transport failed');callback?.(new Error('transport failed'));});
      ws.close.mockImplementation(()=>{throw new Error('close failed');});
      expect(()=>t.write('agent output')).not.toThrow();await t.flush();
      ws.emit('message',JSON.stringify({t:'input',data:'must not reach agent'}));expect(keys).toEqual([]);expect(t.live).toBe(true);
      expect((t as any).viewers.size).toBe(0);
    }finally{expect(()=>t.dispose()).not.toThrow();}
  });

  it('ignores a pending initial snapshot after disconnect or disposal',async()=>{
    const t=new AgentTerminal(),{ws,messages}=viewer();let barrier!:()=>void;
    vi.spyOn((t as any).term,'write').mockImplementationOnce((...args:unknown[])=>{barrier=args[1] as ()=>void;});
    t.attach(ws as unknown as WebSocket);ws.emit('close');t.dispose();expect(()=>barrier()).not.toThrow();expect(messages).toEqual([]);
  });

  it('does not attach duplicate or already closed viewer sockets',async()=>{
    const t=new AgentTerminal(),{ws,messages}=viewer();
    try{t.attach(ws as unknown as WebSocket);t.attach(ws as unknown as WebSocket);await t.flush();expect(messages).toHaveLength(1);expect(ws.listenerCount('message')).toBe(1);
      const closed=viewer();closed.ws.readyState=3;t.attach(closed.ws as unknown as WebSocket);expect(closed.ws.listenerCount('message')).toBe(0);
    }finally{t.dispose();}
  });

  it('delivers output during initial synchronization once and in order',async()=>{
    const t=new AgentTerminal(),{ws,messages}=viewer(),replica=new AgentTerminal();
    try{
      t.write('before barrier\r\n');await t.flush();t.attach(ws as unknown as WebSocket);t.write('after barrier\r\n');await t.flush();
      expect(messages.map(frame=>frame.t)).toEqual(['snapshot','data']);
      for(const frame of messages)replica.write(frame.data);await replica.flush();
      expect(replica.screen().split('after barrier')).toHaveLength(2);expect(replica.screen()).toContain('before barrier');
    }finally{t.dispose();replica.dispose();}
  });

  it('restores saved terminal content and input modes after an office restart',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-terminal-restore-')),t=new AgentTerminal(),restored=new AgentTerminal(),file=path.join(dir,'terminal');
    try{
      await restored.load(path.join(dir,'missing'));expect(restored.screen().trim()).toBe('');
      t.write('\x1b[?1h\x1b[?1006hrestored output\r\n');await t.save(file);await restored.load(file);await restored.flush();
      expect(restored.screen()).toContain('restored output');expect(restored.screen()).toContain('(the office restarted)');expect(restored.appCursor).toBe(true);expect(restored.snapshot()).toContain('\x1b[?1006h');expect(restored.dirty).toBe(false);
      restored.write('\x1b[?1006l\x1b[?1l');await restored.flush();expect(restored.appCursor).toBe(false);expect(restored.snapshot()).not.toContain('\x1b[?1006h');
    }finally{t.dispose();restored.dispose();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
  });

  it('caps pasted input and synchronizes a bounded resize to other viewers',async()=>{
    const t=new AgentTerminal(),first=viewer(),second=viewer(),keys:string[]=[],input=vi.fn();
    try{
      t.bind({write:text=>keys.push(text),resize:()=>{}});t.onInput=input;t.attach(first.ws as unknown as WebSocket);t.attach(second.ws as unknown as WebSocket);await t.flush();
      first.ws.emit('message',JSON.stringify({t:'input',data:'x'.repeat(70000)}));expect(keys[0].length).toBe(65536);expect(input).toHaveBeenCalledExactlyOnceWith(keys[0]);
      first.ws.emit('message',JSON.stringify({t:'resize',cols:9999,rows:0}));expect([t.cols,t.rows]).toEqual([400,5]);expect(second.messages.at(-1)).toEqual({t:'size',cols:400,rows:5});
      const count=second.messages.length;first.ws.emit('message',JSON.stringify({t:'resize',cols:400,rows:5}));expect(t.cols).toBe(400);
      first.ws.emit('message','{"t":"resize","cols":1e999,"rows":5}');expect(second.messages).toHaveLength(count+1);
      t.write('');expect(second.messages).toHaveLength(count+1);
    }finally{t.dispose();}
  });

  it('streams and reconnects real loopback WebSocket viewers without stopping the agent sink',async()=>{
    const t=new AgentTerminal(),keys:string[]=[],server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:MAX_OFFICE_WS_PAYLOAD}),clients:WebSocket[]=[];
    const waitFor=async(predicate:()=>boolean)=>{const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw new Error('Terminal transport observation timed out');await new Promise(resolve=>setTimeout(resolve,10));}};
    try{
      await once(server,'listening');server.on('connection',socket=>t.attach(socket));
      t.bind({write:text=>keys.push(text),resize:()=>{}});t.write('before connection\r\n');await t.flush();
      const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture listener');
      const connect=()=>{const frames:any[]=[];const client=new WebSocket(`ws://127.0.0.1:${address.port}`);clients.push(client);client.on('message',raw=>frames.push(JSON.parse(String(raw))));return {client,frames};};
      const first=connect();await waitFor(()=>first.frames.some(frame=>frame.t==='snapshot'));
      expect(first.frames[0]).toMatchObject({t:'snapshot',live:true});expect(first.frames[0].data).toContain('before connection');
      t.write('live streamed output\r\n');await waitFor(()=>first.frames.some(frame=>frame.t==='data'&&frame.data.includes('live streamed output')));
      first.client.send(JSON.stringify({t:'input',data:'manager input'}));await waitFor(()=>keys.includes('manager input'));
      first.client.send(JSON.stringify({t:'resize',cols:85,rows:24}));await waitFor(()=>t.cols===85&&t.rows===24);
      const closed=once(first.client,'close');first.client.close();await closed;expect(t.live).toBe(true);
      t.write('while disconnected\r\n');await t.flush();const second=connect();await waitFor(()=>second.frames.some(frame=>frame.t==='snapshot'));
      expect(second.frames[0]).toMatchObject({t:'snapshot',cols:85,rows:24,live:true});expect(second.frames[0].data).toContain('while disconnected');
      expect(second.frames[0].data).toContain('live streamed output');
      const oversizedClosed=once(second.client,'close');second.client.send('x'.repeat(MAX_OFFICE_WS_PAYLOAD+1));
      const [code]=await oversizedClosed;expect(code).toBe(1009);expect(t.live).toBe(true);expect(keys).toEqual(['manager input']);
      const third=connect();await waitFor(()=>third.frames.some(frame=>frame.t==='snapshot'));expect(third.frames[0].data).toContain('while disconnected');
    }finally{
      await t.flush();t.dispose();for(const client of clients)client.terminate();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
