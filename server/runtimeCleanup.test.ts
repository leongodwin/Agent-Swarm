import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {RuntimeCleanupStore} from './runtimeCleanup.ts';
import {fork} from 'node:child_process';
import {once} from 'node:events';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'swarm-runtime-cleanup-'));roots.push(root);return path.join(root,'cleanup.json');};
const record={id:'owned-token',agentId:'worker',cli:'codex',pid:123,keeperInstance:'11111111-1111-4111-8111-111111111111',requestedAt:Date.now(),state:'stopping' as const};
it('persists quarantine before release and restores it as unverified across process restarts',()=>{
  const file=fixture(),changed=vi.fn();const store=new RuntimeCleanupStore(file,changed);store.begin(record);
  expect(JSON.parse(fs.readFileSync(file,'utf8')).records).toEqual([record]);expect(changed).toHaveBeenCalledOnce();
  const restored=new RuntimeCleanupStore(file);expect(restored.view().records[0].state).toBe('unverified');
  restored.confirmed(record.id);expect(restored.view().records).toEqual([]);expect(new RuntimeCleanupStore(file).view().records).toEqual([]);
});
it('does not clear evidence on loss of verification or repeated cancellation',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);store.begin(record);store.unverified(record.id);store.begin({...record,state:'unverified'});
  expect(store.view().records).toHaveLength(1);expect(new RuntimeCleanupStore(file).view().records[0].state).toBe('unverified');store.confirmed('foreign-id');expect(store.view().records).toHaveLength(1);
});
it('preserves corrupt evidence and quarantines admission even without known counts',()=>{
  const file=fixture();fs.writeFileSync(file,'forensic evidence');const store=new RuntimeCleanupStore(file);store.begin(record);store.confirmed(record.id);
  expect(store.view().unavailableReason).toContain('unreadable');expect(fs.readFileSync(file,'utf8')).toBe('forensic evidence');expect(store.view().records).toHaveLength(1);
});
it('retains capacity if writing a native confirmation fails',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);store.begin(record);fs.unlinkSync(file);fs.mkdirSync(file);store.confirmed(record.id);
  expect(store.view().records).toHaveLength(1);expect(store.view().unavailableReason).toContain('could not be saved');
});
it('merges independent writers and refreshes foreign quarantine before admission',()=>{
  const file=fixture(),a=new RuntimeCleanupStore(file),b=new RuntimeCleanupStore(file);
  a.begin(record);b.begin({...record,id:'second-root',pid:456});
  expect(a.view().records.map(row=>row.id).sort()).toEqual(['owned-token','second-root']);
  expect(b.view().records).toHaveLength(2);
  a.confirmed(record.id);
  expect(b.view().records.map(row=>row.id)).toEqual(['second-root']);
  b.unverified('second-root');b.confirmed('second-root');
  expect(new RuntimeCleanupStore(file).view()).toEqual({records:[]});
});
it.each(['confirmation','refresh','begin'])('preserves a changed root identity on stale %s',action=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);store.begin(record);
  const changed={...record,pid:789,requestedAt:record.requestedAt+1};
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,records:[changed]}));
  if(action==='confirmation')store.confirmed(record.id);
  else if(action==='begin')store.begin(record);
  else store.view();
  expect(store.view().unavailableReason).toContain('quarantined');
  expect(JSON.parse(fs.readFileSync(file,'utf8')).records).toEqual([changed]);
});
it('does not resurrect stale records already confirmed by another writer',()=>{
  const file=fixture(),a=new RuntimeCleanupStore(file);a.begin(record);
  const b=new RuntimeCleanupStore(file);b.confirmed(record.id);
  a.begin({...record,id:'next-root'});
  expect(new RuntimeCleanupStore(file).view().records.map(row=>row.id)).toEqual(['next-root']);
});
it('ignores a stale loss-of-verification update after another writer confirms exit',()=>{
  const file=fixture(),a=new RuntimeCleanupStore(file);a.begin(record);
  new RuntimeCleanupStore(file).confirmed(record.id);a.unverified(record.id);
  expect(a.view()).toEqual({records:[]});expect(new RuntimeCleanupStore(file).view()).toEqual({records:[]});
});
it('quarantines a repeated stale registration rather than resurrecting its acknowledged root',()=>{
  const file=fixture(),a=new RuntimeCleanupStore(file);a.begin(record);
  new RuntimeCleanupStore(file).confirmed(record.id);a.begin(record);
  expect(a.view().unavailableReason).toContain('quarantined');
  expect(new RuntimeCleanupStore(file).view()).toEqual({records:[]});
});
it('rejects registering a different root under an already observed token',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);store.begin(record);
  store.begin({...record,pid:456});
  expect(store.view().unavailableReason).toContain('identity conflict');
  expect(JSON.parse(fs.readFileSync(file,'utf8')).records).toEqual([record]);
});
it('retains local evidence and removes the temporary snapshot when its durable flush fails',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);
  const flush=vi.spyOn(fs,'fsyncSync').mockImplementationOnce(()=>{throw new Error('Synthetic I/O failure');});
  try{store.begin(record);}finally{flush.mockRestore();}
  expect(store.view().unavailableReason).toContain('could not be saved');expect(store.view().records).toEqual([record]);
  expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file+'.lock.queue')]);expect(fs.readdirSync(file+'.lock.queue')).toEqual([]);
});
it('keeps admission quarantined if lock ownership changes after snapshot replacement',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);store.begin(record);
  const rename=fs.renameSync;
  const changed=JSON.stringify({pid:process.pid,token:'22222222-2222-4222-8222-222222222222'});
  const spy=vi.spyOn(fs,'renameSync').mockImplementation((from,to)=>{rename(from,to);if(String(to)===file)fs.writeFileSync(file+'.lock',changed);});
  try{store.confirmed(record.id);}finally{spy.mockRestore();}
  expect(store.view().unavailableReason).toContain('ownership is unverified');
  expect(fs.readFileSync(file+'.lock','utf8')).toBe(changed);
});
it('never treats an inaccessible PID as a dead writer',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);
  const lock=JSON.stringify({pid:process.pid,token:'11111111-1111-4111-8111-111111111111'});fs.writeFileSync(file+'.lock',lock);
  const spy=vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('Synthetic access denied'),{code:'EPERM'});});
  try{expect(store.view().unavailableReason).toContain('writer');}finally{spy.mockRestore();}
  expect(fs.readFileSync(file+'.lock','utf8')).toBe(lock);
});
it.each([false,true])('retries transient exclusive-create sharing errors without granting ownership on permanent denial: %s',permanent=>{
  const file=fixture(),open=fs.openSync;let failures=0;
  const spy=vi.spyOn(fs,'openSync').mockImplementation((...args)=>{
    if(String(args[0]).endsWith('.queue-lock')&&args[1]==='wx'&&(permanent||failures<2)){failures++;throw Object.assign(new Error('Synthetic sharing denial'),{code:'EPERM'});}
    return open(...args);
  });
  let view;
  try{const store=new RuntimeCleanupStore(file);store.begin(record);view=store.view();}finally{spy.mockRestore();}
  if(permanent){expect(view.unavailableReason).toContain('quarantined');expect(view.failureSystemCode).toBe('EPERM');expect(fs.existsSync(file)).toBe(false);}
  else{expect(failures).toBe(2);expect(view.unavailableReason).toBeUndefined();expect(JSON.parse(fs.readFileSync(file,'utf8')).records).toEqual([record]);}
});
it.each(['live','incomplete','corrupt','oversized'])('retains local quarantine and preserves the %s writer lock',kind=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);
  const content=kind==='live'?JSON.stringify({pid:process.pid,token:'11111111-1111-4111-8111-111111111111'}):kind==='incomplete'?'':kind==='corrupt'?'invalid': ' '.repeat(4097);
  fs.writeFileSync(file+'.lock',content);store.begin(record);store.confirmed(record.id);
  expect(store.view().unavailableReason).toContain('quarantined');expect(store.view().records).toHaveLength(1);
  expect(fs.readFileSync(file+'.lock','utf8')).toBe(content);expect(fs.existsSync(file)).toBe(false);
});
it('temporarily blocks a reader while a live writer has not published its records',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);
  fs.writeFileSync(file+'.lock',JSON.stringify({pid:process.pid,token:'11111111-1111-4111-8111-111111111111'}));
  expect(store.view().unavailableReason).toContain('writer');
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,records:[record]}));fs.unlinkSync(file+'.lock');
  expect(store.view()).toEqual({records:[{...record,state:'unverified'}]});
});
it('reports a safe diagnostic code for a transient reader failure without permanently quarantining it',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),open=fs.openSync;
  const spy=vi.spyOn(fs,'openSync').mockImplementation((...args)=>{
    if(String(args[0]).endsWith('.queue-lock')&&args[1]==='wx')throw Object.assign(new Error('private file details'),{code:'EACCES'});
    return open(...args);
  });
  try{const view=store.view();expect(view).toMatchObject({failureCode:'io',failureSystemCode:'EACCES'});expect(JSON.stringify(view)).not.toContain('private');}
  finally{spy.mockRestore();}
  expect(store.view()).toEqual({records:[]});
});
it('does not let new callers overtake a live queued writer or remove its ticket on timeout',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),queue=file+'.lock.queue';fs.mkdirSync(queue,{recursive:true});
  const ticket={pid:process.pid,token:'11111111-1111-4111-8111-111111111111',sequence:0};const name=path.join(queue,ticket.token+'.json');fs.writeFileSync(name,JSON.stringify(ticket));
  store.begin(record);expect(store.view().failureCode).toBe('contention');expect(store.view().records).toEqual([record]);
  expect(fs.readdirSync(queue)).toEqual([ticket.token+'.json']);expect(JSON.parse(fs.readFileSync(name,'utf8'))).toEqual(ticket);
});
it('reports queue backpressure without publishing a sixty-fifth ticket',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),queue=file+'.lock.queue';fs.mkdirSync(queue,{recursive:true});
  for(let i=0;i<64;i++){const token=`11111111-1111-4111-8111-${i.toString(16).padStart(12,'0')}`;fs.writeFileSync(path.join(queue,token+'.json'),JSON.stringify({pid:process.pid,token,sequence:i}));}
  store.begin(record);expect(store.view().failureCode).toBe('contention');expect(fs.readdirSync(queue)).toHaveLength(64);
});
it.each([false,true])('retries transient ticket-read sharing errors and preserves permanently denied evidence: %s',permanent=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),queue=file+'.lock.queue';fs.mkdirSync(queue,{recursive:true});
  const ticket={pid:99999999,token:'11111111-1111-4111-8111-111111111111',sequence:0},name=path.join(queue,ticket.token+'.json'),content=JSON.stringify(ticket);fs.writeFileSync(name,content);
  const open=fs.openSync;let failures=0;
  const spy=vi.spyOn(fs,'openSync').mockImplementation((...args)=>{if(String(args[0])===name&&args[1]==='r'&&(permanent||failures<2)){failures++;throw Object.assign(new Error('private transient file details'),{code:'EPERM'});}return open(...args);});
  let view;
  try{view=store.view();}finally{spy.mockRestore();}
  expect(JSON.stringify(view)).not.toContain('private');
  if(permanent){expect(view).toMatchObject({failureCode:'io',failureSystemCode:'EPERM'});expect(fs.readFileSync(name,'utf8')).toBe(content);}
  else{expect(failures).toBe(2);expect(view).toEqual({records:[]});expect(fs.existsSync(name)).toBe(false);}
});
it('rechecks ownership after a transient release read instead of removing a replacement owner',()=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),allocator=file+'.lock.queue-lock',content=JSON.stringify({pid:process.pid,token:'11111111-1111-4111-8111-111111111111'}),open=fs.openSync;let injected=false;
  const spy=vi.spyOn(fs,'openSync').mockImplementation((...args)=>{
    if(String(args[0])===allocator&&args[1]==='r'&&!injected){injected=true;fs.writeFileSync(allocator,content);throw Object.assign(new Error('Transient sharing error'),{code:'EPERM'});}
    return open(...args);
  });
  let view;
  try{view=store.view();}finally{spy.mockRestore();}
  expect(injected).toBe(true);expect(view.unavailableReason).toContain('quarantined');expect(fs.readFileSync(allocator,'utf8')).toBe(content);
});
it.each(['unknown-ticket','changed-own-ticket'])('validates queue evidence after a readiness hint changes: %s',fault=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),queue=file+'.lock.queue';fs.mkdirSync(queue,{recursive:true});
  const predecessor={pid:process.pid,token:'11111111-1111-4111-8111-111111111111',sequence:0},head=path.join(queue,predecessor.token+'.json');fs.writeFileSync(head,JSON.stringify(predecessor));
  const exists=fs.existsSync;let changed=false;
  const spy=vi.spyOn(fs,'existsSync').mockImplementation(target=>{
    if(String(target)===head&&!changed){
      changed=true;fs.unlinkSync(head);
      if(fault==='unknown-ticket')fs.writeFileSync(path.join(queue,'unverified'),'private evidence');
      else{const own=fs.readdirSync(queue).find(name=>name.endsWith('.json'))!;const file=path.join(queue,own),ticket=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify({...ticket,sequence:ticket.sequence+1}));}
      return false;
    }
    return exists(target);
  });
  try{store.begin(record);}finally{spy.mockRestore();}
  const view=store.view();expect(changed).toBe(true);expect(view.unavailableReason).toContain('quarantined');expect(view.records).toEqual([record]);expect(fs.existsSync(file)).toBe(false);expect(fs.readdirSync(queue).length).toBeGreaterThan(0);
});
it.each(['malformed','wrong-name','duplicate-sequence','unknown-file','oversized'])('preserves %s queued evidence and emits a safe diagnostic code',fault=>{
  const file=fixture(),store=new RuntimeCleanupStore(file),queue=file+'.lock.queue';fs.mkdirSync(queue,{recursive:true});
  const ticket={pid:process.pid,token:'11111111-1111-4111-8111-111111111111',sequence:0},name=path.join(queue,ticket.token+'.json');
  if(fault==='malformed')fs.writeFileSync(name,'private invalid evidence');
  else if(fault==='wrong-name')fs.writeFileSync(name,JSON.stringify({...ticket,token:'22222222-2222-4222-8222-222222222222'}));
  else if(fault==='unknown-file')fs.writeFileSync(path.join(queue,'unexpected'),'private invalid evidence');
  else if(fault==='oversized')fs.writeFileSync(name,' '.repeat(4097));
  else{fs.writeFileSync(name,JSON.stringify(ticket));const other={...ticket,token:'22222222-2222-4222-8222-222222222222'};fs.writeFileSync(path.join(queue,other.token+'.json'),JSON.stringify(other));}
  const before=fs.readdirSync(queue);store.begin(record);const view=store.view();
  expect(view.failureCode).toBe('evidence');expect(view.unavailableReason).not.toContain('private');expect(fs.readdirSync(queue)).toEqual(before);expect(fs.existsSync(file)).toBe(false);
});
it.each(['missing','oversized','duplicate','non-file'])('quarantines %s evidence without silently clearing known roots',kind=>{
  const file=fixture(),store=new RuntimeCleanupStore(file);store.begin(record);
  if(kind==='missing')fs.unlinkSync(file);
  if(kind==='oversized')fs.writeFileSync(file,' '.repeat(1024*1024+1));
  if(kind==='duplicate')fs.writeFileSync(file,JSON.stringify({schemaVersion:1,records:[record,record]}));
  if(kind==='non-file'){fs.unlinkSync(file);fs.mkdirSync(file);}
  expect(store.view().unavailableReason).toContain('quarantined');expect(store.view().records).toHaveLength(1);
});
it.each([{writers:2,count:20,delay:0},{writers:3,count:20,delay:10},{writers:3,count:20,delay:30}])('serializes $writers native processes with $delay ms flush latency',async({writers,count,delay})=>{
  const file=fixture(),script=path.join(path.dirname(file),'writer.mjs');
  const module=new URL('./runtimeCleanup.ts',import.meta.url).href;
  fs.writeFileSync(script,`import fs from 'node:fs';import {RuntimeCleanupStore} from ${JSON.stringify(module)};
    const flush=fs.fsyncSync;fs.fsyncSync=fd=>{if(${delay})Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${delay});return flush(fd);};
    const [file,prefix]=process.argv.slice(2);const store=new RuntimeCleanupStore(file);
    process.send('ready');process.once('message',()=>{
      for(let i=0;i<${count};i++)store.begin({id:prefix+'-'+i,agentId:prefix,cli:'codex',pid:process.pid,keeperInstance:null,requestedAt:i,state:'stopping'});
      store.confirmed(prefix+'-0');const view=store.view();
      if(view.unavailableReason){console.error(JSON.stringify({reason:view.unavailableReason,code:view.failureCode,systemCode:view.failureSystemCode,pid:process.pid,count:view.records.length}));process.exitCode=1;}
      process.disconnect();
    });`);
  const prefixes=Array.from({length:writers},(_,i)=>String.fromCharCode(97+i));
  const children=prefixes.map(prefix=>fork(script,[file,prefix],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']}));
  const exits=children.map(async child=>{let stderr='';child.stderr?.on('data',chunk=>{stderr+=chunk;});const [code]=await once(child,'exit');return {code,stderr};});
  try{
    await Promise.all(children.map(child=>once(child,'message')));
    for(const child of children)child.send('start');
    expect(await Promise.all(exits)).toEqual(prefixes.map(()=>({code:0,stderr:''})));
    const view=new RuntimeCleanupStore(file).view();expect(view.unavailableReason).toBeUndefined();
    expect(view.records.map(row=>row.id).sort()).toEqual(prefixes.flatMap(prefix=>Array.from({length:count-1},(_,i)=>prefix+'-'+(i+1))).sort());
    expect(fs.existsSync(file+'.lock')).toBe(false);
  }finally{for(const child of children)if(child.exitCode===null)child.kill();await Promise.allSettled(exits);}
},15000);
it('recovers a complete interrupted local-writer lock only after its native process exits',async()=>{
  const file=fixture(),script=path.join(path.dirname(file),'dead-writer.mjs');
  fs.writeFileSync(script,'process.send("ready");process.disconnect();');
  const child=fork(script,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});const exit=once(child,'exit');
  await once(child,'message');const pid=child.pid!;await exit;
  const lock=JSON.stringify({pid,token:'11111111-1111-4111-8111-111111111111'});
  const queue=file+'.lock.queue';fs.mkdirSync(queue);fs.writeFileSync(path.join(queue,'11111111-1111-4111-8111-111111111111.json'),JSON.stringify({pid,token:'11111111-1111-4111-8111-111111111111',sequence:0}));
  fs.writeFileSync(file+'.lock',lock);
  const store=new RuntimeCleanupStore(file);expect(store.view()).toEqual({records:[]});
  store.begin(record);expect(store.view().unavailableReason).toBeUndefined();
  expect(new RuntimeCleanupStore(file).view().records).toEqual([{...record,state:'unverified'}]);
  expect(fs.existsSync(file+'.lock')).toBe(false);
  fs.writeFileSync(file+'.lock',lock);fs.mkdirSync(file+'.lock.reaping');
  expect(store.view().unavailableReason).toContain('writer');
  expect(fs.readFileSync(file+'.lock','utf8')).toBe(lock);expect(fs.existsSync(file+'.lock.reaping')).toBe(true);
},10000);
