import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {installWorkerPreflight} from './workerPreflightInstall.ts';
import {WorkerPreflight,type WorkerPreflightPlan} from './workerPreflight.ts';
import type {SkillCatalogue} from './skillRegistry.ts';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const hash=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'preflight-install-independent-'));roots.push(root);const checkout=path.join(root,'checkout');await fs.mkdir(checkout);
 const content='Synthetic skill guidance, no provider or tenant authorization.',file=path.join(root,'SKILL.md');await fs.writeFile(file,content);
 const skill={id:'synthetic:guide',name:'guide',description:'Synthetic installation test guidance',platform:'dataverse' as const,file,source:'shared' as const,sha256:hash(content),toolStatus:'unverified' as const};
 const catalogue=():SkillCatalogue=>({fingerprint:'fixture',warnings:[],skills:[skill]});
 const plan:WorkerPreflightPlan={schemaVersion:1,mode:'authoring',scope:'Synthetic independent installer tests only',maxAgeSeconds:60,skills:[{id:skill.id,sha256:skill.sha256}],probes:[{id:'identity-target',tool:'mcp__synthetic__inspect',readOnly:true,input:{environment:'synthetic'},assertions:[{kind:'identity',pointer:['user'],equals:'qa@example.test'},{kind:'target',pointer:['environment'],equals:'synthetic'},{kind:'access',pointer:['allowed'],equals:true}]}]};
 return{root,checkout,plan,content,skill,catalogue,file:path.join(checkout,'.cubefarm/worker-preflight.json')};
}
it.each(['duplicate','unknown-field','oversized','wrong-hash','missing-guidance','changed-guidance'])('refuses %s publication before creating a contract',async mode=>{
 const f=await fixture();let text=JSON.stringify(f.plan);if(mode==='duplicate')text=text.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');if(mode==='unknown-field')text=JSON.stringify({...f.plan,approve:true});if(mode==='oversized')text+=' '.repeat(32768);if(mode==='missing-guidance')f.plan.skills[0].id='missing';if(mode==='changed-guidance')await fs.writeFile(f.skill.file,'changed');if(mode==='missing-guidance')text=JSON.stringify(f.plan);
 await expect(installWorkerPreflight(f.checkout,text,mode==='wrong-hash'?'a'.repeat(64):hash(text),{catalogue:f.catalogue})).rejects.toThrow();expect(await fs.stat(f.file).catch(()=>null)).toBeNull();
});
it('publishes reviewed exact bytes but leaves every new session blocked until real reads and probes',async()=>{
 const f=await fixture(),text=JSON.stringify(f.plan,null,2);const result=await installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue});expect(await fs.readFile(result.file,'utf8')).toBe(text);expect(result.readiness).toBe('requires-fresh-worker-observations');
 const gate=new WorkerPreflight(f.checkout,f.catalogue);expect(gate.blocker()).toContain('Read every pinned');
 expect(gate.before('skill','mcp__office__read_skill',f.plan.skills[0])).toBeNull();gate.after('skill',{...f.plan.skills[0],content:f.content},false);expect(gate.blocker()).toContain('exact reviewed');
 const probe=f.plan.probes[0];expect(gate.before('probe',probe.tool,probe.input)).toBeNull();gate.after('probe',{user:'qa@example.test',environment:'synthetic',allowed:true},false);expect(gate.blocker()).toBeNull();
 expect(new WorkerPreflight(f.checkout,f.catalogue).blocker()).toContain('Read every pinned');
});
it('never overwrites an existing contract or directory target',async()=>{
 const f=await fixture(),text=JSON.stringify(f.plan);await fs.mkdir(path.dirname(f.file));await fs.writeFile(f.file,'existing-owner');await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue})).rejects.toThrow();expect(await fs.readFile(f.file,'utf8')).toBe('existing-owner');await fs.unlink(f.file);await fs.mkdir(f.file);await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue})).rejects.toThrow();expect((await fs.stat(f.file)).isDirectory()).toBe(true);
});
it('allows exactly one concurrent publication and cleans temporary files',async()=>{
 const f=await fixture(),one=JSON.stringify(f.plan),two=JSON.stringify({...f.plan,scope:'A separately reviewed synthetic contract'});const results=await Promise.allSettled([installWorkerPreflight(f.checkout,one,hash(one),{catalogue:f.catalogue}),installWorkerPreflight(f.checkout,two,hash(two),{catalogue:f.catalogue})]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect([one,two]).toContain(await fs.readFile(f.file,'utf8'));expect(await fs.readdir(path.dirname(f.file))).toEqual(['worker-preflight.json']);
});
it.each(['checkout','contract-directory'])('rejects linked %s without writing outside the checkout',async mode=>{
 const f=await fixture(),outside=path.join(f.root,'outside');await fs.mkdir(outside);const link=mode==='checkout'?path.join(f.root,'linked-checkout'):path.dirname(f.file);await fs.symlink(outside,link,'junction');const text=JSON.stringify(f.plan);await expect(installWorkerPreflight(mode==='checkout'?link:f.checkout,text,hash(text),{catalogue:f.catalogue})).rejects.toThrow(/canonical|linked/);expect(await fs.readdir(outside)).toEqual([]);
});
it('refuses revoked ownership before publication and cleans its private temporary file',async()=>{
 const f=await fixture(),text=JSON.stringify(f.plan),open=fs.open.bind(fs);let revoked=false;
 vi.spyOn(fs,'open').mockImplementation((async(...args:any[])=>{const handle=await Reflect.apply(open,fs,args);if(args[1]==='wx')revoked=true;return handle;}) as typeof fs.open);
 await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue,guard:()=>{if(revoked)throw Error('ownership revoked');}})).rejects.toThrow('ownership revoked');expect(await fs.stat(f.file).catch(()=>null)).toBeNull();expect(await fs.readdir(path.dirname(f.file))).toEqual([]);
});
it('does not report installed success when authority is revoked during atomic publication',async()=>{
 const f=await fixture(),text=JSON.stringify(f.plan),link=fs.link.bind(fs);let revoked=false;vi.spyOn(fs,'link').mockImplementation(async(...args)=>{await link(...args);revoked=true;});await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue,guard:()=>{if(revoked)throw Error('ownership revoked');}})).rejects.toThrow('ownership revoked');
});
it('publishes a valid discovery contract without granting authoring readiness',async()=>{
 const f=await fixture(),text=JSON.stringify({...f.plan,mode:'discovery'});const result=await installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue});expect(result.installed).toBe(true);
 const discovery=new WorkerPreflight(f.checkout,f.catalogue,undefined,'codex','discovery');expect(discovery.configurationBlocker()).toBeNull();expect(discovery.observed().ready).toBe(false);expect(discovery.before('edit','Edit',{})).toContain('Read-only discovery');
 expect(new WorkerPreflight(f.checkout,f.catalogue).configurationBlocker()).toContain('Discovery-only');
});
it.each(['invalid-json','valid-different-contract'])('refuses %s target changes during publication without deleting foreign bytes',async mode=>{
 const f=await fixture(),text=JSON.stringify(f.plan),replacement=mode==='invalid-json'?'{invalid':JSON.stringify({...f.plan,scope:'Unreviewed replacement contract'}),link=fs.link.bind(fs);
 vi.spyOn(fs,'link').mockImplementation(async(...args)=>{await link(...args);await fs.writeFile(f.file,replacement);});
 await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue})).rejects.toThrow();expect(await fs.readFile(f.file,'utf8')).toBe(replacement);
});
it('refuses a successor file with identical bytes but different publication ownership',async()=>{
 const f=await fixture(),text=JSON.stringify(f.plan),link=fs.link.bind(fs);
 vi.spyOn(fs,'link').mockImplementation(async(...args)=>{await link(...args);await fs.unlink(f.file);await fs.writeFile(f.file,text);});
 await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue})).rejects.toThrow('identity changed');expect(await fs.readFile(f.file,'utf8')).toBe(text);
});
it('rejects a successor inode above Number precision despite identical reviewed bytes',async()=>{
 const f=await fixture(),text=JSON.stringify(f.plan),original=9007199254740992n,successor=9007199254740993n;expect(Number(original)).toBe(Number(successor));
 const open=fs.open.bind(fs),lstat=fs.lstat.bind(fs);let captured=false,checked=false;
 vi.spyOn(fs,'open').mockImplementation((async(...args:any[])=>{const handle=await Reflect.apply(open,fs,args);if(args[1]==='wx'){const stat=handle.stat.bind(handle);vi.spyOn(handle,'stat').mockImplementation((async(options:any)=>{const value=await stat(options);if(options?.bigint){captured=true;Object.assign(value,{ino:original,dev:1n});}return value;}) as typeof handle.stat);}return handle;}) as typeof fs.open);
 vi.spyOn(fs,'lstat').mockImplementation((async(file:any,options:any)=>{const value=await lstat(file,options);if(String(file)===f.file&&options?.bigint){checked=true;Object.assign(value,{ino:successor,dev:1n});}return value;}) as typeof fs.lstat);
 await expect(installWorkerPreflight(f.checkout,text,hash(text),{catalogue:f.catalogue})).rejects.toThrow('identity changed');expect(captured).toBe(true);expect(checked).toBe(true);expect(await fs.readFile(f.file,'utf8')).toBe(text);
});
