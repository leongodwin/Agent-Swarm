import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {RuntimeCleanupStore} from './runtimeCleanup.ts';
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
