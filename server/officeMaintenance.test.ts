import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {OfficeMaintenance} from './officeMaintenance.ts';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'office-maintenance-'));roots.push(root);const file=path.join(root,'maintenance.json');return {root,file,state:new OfficeMaintenance(file)};}
it('restores drain and explicit resume in new service instances, before callbacks',async()=>{
  const {file,state}=await fixture();await state.init();expect(state.draining).toBe(false);
  const apply=vi.fn(()=>expect(JSON.parse(readFileSync(file,'utf8')).draining).toBe(true));
  await state.change(true,()=>{expect(state.draining).toBe(true);apply();});await state.close();
  const recovered=new OfficeMaintenance(file);await recovered.init();expect(recovered.draining).toBe(true);
  await recovered.change(false,()=>expect(recovered.draining).toBe(false));
  const resumed=new OfficeMaintenance(file);await resumed.init();expect(resumed.draining).toBe(false);expect(apply).toHaveBeenCalledOnce();
});
it.each(['null','{}','{"version":2,"draining":true}','{"version":1,"draining":"false"}','{"version":1,"draining":true,"extra":0}','bad json','x'.repeat(4097)])('preserves malformed evidence and refuses mutation: %#',async text=>{
  const {file,state}=await fixture();await fs.writeFile(file,text);await expect(state.init()).rejects.toThrow();
  await expect(state.change(false,vi.fn())).rejects.toThrow('unavailable');expect(await fs.readFile(file,'utf8')).toBe(text);
});
it('serializes competing drain and resume requests including their application',async()=>{
  const {file,state}=await fixture();await state.init();const observed:boolean[]=[];
  await Promise.all([state.change(true,()=>observed.push(state.draining)),state.change(false,()=>observed.push(state.draining)),state.change(true,()=>observed.push(state.draining))]);
  expect(observed).toEqual([true,false,true]);expect(JSON.parse(await fs.readFile(file,'utf8')).draining).toBe(true);
});
it('does not resume services on failed persistence and removes its temporary file',async()=>{
  const {root,file,state}=await fixture();await state.init();await state.change(true,()=>undefined);
  vi.spyOn(fs,'rename').mockRejectedValueOnce(new Error('synthetic permission failure'));const apply=vi.fn();
  await expect(state.change(false,apply)).rejects.toThrow('permission failure');expect(apply).not.toHaveBeenCalled();expect(state.draining).toBe(true);
  expect(JSON.parse(await fs.readFile(file,'utf8')).draining).toBe(true);expect(await fs.readdir(root)).toEqual(['maintenance.json']);
  await state.change(false,apply);expect(apply).toHaveBeenCalledOnce();
});
it('closes admission immediately and denies queued changes without altering persisted state',async()=>{
  const {file,state}=await fixture();await state.init();await state.change(true,()=>undefined);const apply=vi.fn();
  const pending=state.change(false,apply);const closing=state.close();await expect(pending).rejects.toThrow('closed');await closing;
  await expect(state.change(false,apply)).rejects.toThrow('unavailable');expect(apply).not.toHaveBeenCalled();expect(JSON.parse(await fs.readFile(file,'utf8')).draining).toBe(true);
  await expect(state.init()).rejects.toThrow('already');
});

it('waits for an in-flight write on shutdown and prevents its rename/application',async()=>{
  const {root,file,state}=await fixture();await state.init();await state.change(true,()=>undefined);
  let entered!:()=>void;const syncing=new Promise<void>(resolve=>{entered=resolve;});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const realOpen=fs.open.bind(fs);
  vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
    const handle=await realOpen(...args);
    if(String(args[0]).endsWith('.tmp')){
      const realSync=handle.sync.bind(handle);handle.sync=async()=>{entered();await gate;await realSync();};
    }
    return handle;
  });
  const apply=vi.fn();const pending=state.change(false,apply);await syncing;
  let ended=false;const closing=state.close().then(()=>{ended=true;});await Promise.resolve();expect(ended).toBe(false);
  release();await expect(pending).rejects.toThrow('closed');await closing;
  expect(apply).not.toHaveBeenCalled();expect(JSON.parse(await fs.readFile(file,'utf8')).draining).toBe(true);expect(await fs.readdir(root)).toEqual(['maintenance.json']);
});
