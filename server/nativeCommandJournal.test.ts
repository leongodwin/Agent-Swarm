import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {journalNativeCommand,inspectNativeCommands,nativeRecoveryEligible,initializeNativeEpoch} from './nativeCommandJournal.ts';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-intent-'));roots.push(root);const lease=Buffer.from(JSON.stringify({token:crypto.randomUUID()}));const hash=crypto.createHash('sha256').update(lease).digest('hex');return {root,lease,hash,directory:path.join(root,'delivery-native',hash)};}
const command={executable:'provider',args:['secret-argument']};
it('flushes attributable intent before dispatch and never equates root return with tree quiescence',async()=>{
 const f=await fixture();const runId=crypto.randomUUID();let dispatched=false;
 const result=await journalNativeCommand(f.root,f.hash,command,f.root,runId,async()=>{},async()=>{
  const names=await fs.readdir(f.directory);expect(names).toHaveLength(1);const bytes=await fs.readFile(path.join(f.directory,names[0]),'utf8');expect(bytes).not.toContain('secret-argument');expect(JSON.parse(bytes)).toMatchObject({runId,leaseSha256:f.hash});
  expect(await inspectNativeCommands(f.root,f.lease)).toMatchObject({commands:1,unresolved:1,nativeTreeQuiescenceVerified:false});dispatched=true;return 'output';
 });
 expect(dispatched).toBe(true);expect(result).toBe('output');expect(await inspectNativeCommands(f.root,f.lease)).toMatchObject({commands:1,unresolved:0,nativeTreeQuiescenceVerified:false});
});
it('preserves unresolved intent when ownership is revoked before launch',async()=>{
 const f=await fixture(),run=vi.fn();await expect(journalNativeCommand(f.root,f.hash,command,f.root,undefined,async()=>{throw new Error('revoked');},run)).rejects.toThrow('revoked');expect(run).not.toHaveBeenCalled();expect(await inspectNativeCommands(f.root,f.lease)).toMatchObject({unresolved:1});
});
it('records rejected dispatch without saving provider output or claiming termination',async()=>{
 const f=await fixture();await expect(journalNativeCommand(f.root,f.hash,command,f.root,undefined,async()=>{},async()=>{throw new Error('private provider output');})).rejects.toThrow('private provider output');
 const name=(await fs.readdir(f.directory)).find(name=>name.endsWith('.result.json'))!;const bytes=await fs.readFile(path.join(f.directory,name),'utf8');expect(bytes).not.toContain('private');expect(JSON.parse(bytes)).toMatchObject({outcome:'rejected',nativeTreeQuiescenceVerified:false});
});
it('treats legacy coverage as missing and binds inventory fingerprint to contents',async()=>{
 const f=await fixture();expect(await inspectNativeCommands(f.root,f.lease)).toMatchObject({coverage:'legacy-or-missing'});
 await journalNativeCommand(f.root,f.hash,command,f.root,undefined,async()=>{},async()=>{});const before=await inspectNativeCommands(f.root,f.lease);
 const name=(await fs.readdir(f.directory)).find(name=>name.endsWith('.result.json'))!,file=path.join(f.directory,name),row=JSON.parse(await fs.readFile(file,'utf8'));row.outcome='rejected';await fs.writeFile(file,JSON.stringify(row));expect((await inspectNativeCommands(f.root,f.lease)).journalSha256).not.toBe(before.journalSha256);
});
it.each(['unknown','foreign-owner','orphan-result','claimed-proof','nonregular','oversized','result-time'])('rejects %s journal evidence',async fault=>{
 const f=await fixture();await journalNativeCommand(f.root,f.hash,command,f.root,undefined,async()=>{},async()=>{});
 const names=await fs.readdir(f.directory),intentName=names.find(name=>name.endsWith('.intent.json'))!,resultName=names.find(name=>name.endsWith('.result.json'))!,file=path.join(f.directory,intentName),resultFile=path.join(f.directory,resultName);
 if(fault==='unknown')await fs.writeFile(path.join(f.directory,'unexpected'),'{}');
 if(fault==='foreign-owner'){const row=JSON.parse(await fs.readFile(file,'utf8'));row.leaseSha256='0'.repeat(64);await fs.writeFile(file,JSON.stringify(row));}
 if(fault==='orphan-result')await fs.unlink(file);
 if(fault==='claimed-proof'){const row=JSON.parse(await fs.readFile(resultFile,'utf8'));row.nativeTreeQuiescenceVerified=true;await fs.writeFile(resultFile,JSON.stringify(row));}
 if(fault==='nonregular'){await fs.unlink(file);await fs.mkdir(file);}
 if(fault==='oversized')await fs.writeFile(file,' '.repeat(16385));
 if(fault==='result-time'){const row=JSON.parse(await fs.readFile(resultFile,'utf8'));row.returnedAt='2000-01-01T00:00:00.000Z';await fs.writeFile(resultFile,JSON.stringify(row));}
 await expect(inspectNativeCommands(f.root,f.lease)).rejects.toThrow();
});
it('does not dispatch if durable intent cannot be synced',async()=>{
 const f=await fixture(),run=vi.fn(),open=fs.open.bind(fs);vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const handle=await open(...args);if(String(args[0]).endsWith('.intent.json'))vi.spyOn(handle,'sync').mockRejectedValue(new Error('sync failed'));return handle;});
 await expect(journalNativeCommand(f.root,f.hash,command,f.root,undefined,async()=>{},run)).rejects.toThrow('sync failed');expect(run).not.toHaveBeenCalled();
});

it.each([
 ['git',['rev-parse','HEAD'],true],['git',['rev-parse','origin/main'],true],['git',['show','a'.repeat(40)+':file.md'],true],
 ['git',['show','--textconv','HEAD:file'],false],['git',['worktree','add','other'],false],['git',['rev-parse','--upload-pack=evil'],false],
 ['dataverse',['auth','who'],true],['dataverse',['api','request','--target','dataverse','--environment','https://example.test','--method','GET','--path','/api/data/v9.2/WhoAmI'],true],
 ['dataverse',['api','request','--method','GET','--method','POST','--target','dataverse','--path','/api/data/v9.2/WhoAmI'],false],
 ['dataverse',['api','request','--target','dataverse','--environment','https://example.test','--method','POST','--path','/api/data/v9.2/WhoAmI'],false],
 ['dataverse',['api','request','--target','other-platform','--environment','https://example.test','--method','GET','--path','/api/data/v9.2/WhoAmI'],false],
 ['dataverse',['api','request','--target','dataverse','--environment','http://example.test','--method','GET','--path','/api/data/v9.2/WhoAmI'],false],
 ['dataverse',['api','request','--target','dataverse','--environment','https://example.test','--method','GET','--path','/outside-approved-api'],false],
 ['dataverse',['api','request','--target','dataverse','--unknown','https://example.test','--method','GET','--path','/api/data/v9.2/WhoAmI'],false],
 ['dataverse',['api','request'],false],['pac',['solution','import'],true],['pac.launcher.exe',['solution','list'],true],['pac',['auth','create'],false],['npm',['run','build'],false],['external-browser-verification',[],false]
] as [string,string[],boolean][])('bounds recovery eligibility for %s %j',async(executable,args,expected)=>{expect(nativeRecoveryEligible({executable,args})).toBe(expected);});
it.each(['missing','foreign','nonregular'])('refuses incomplete native epoch coverage: %s',async mode=>{
 const f=await fixture();await initializeNativeEpoch(f.root,f.hash);const file=path.join(f.directory,'epoch.json');
 if(mode==='missing')await fs.unlink(file);
 if(mode==='foreign')await fs.writeFile(file,JSON.stringify({schemaVersion:1,leaseSha256:'0'.repeat(64),journalRequired:true}));
 if(mode==='nonregular'){await fs.unlink(file);await fs.mkdir(file);}
 if(mode==='missing')expect((await inspectNativeCommands(f.root,f.lease)).nativeTreeQuiescenceVerified).toBe(false);
 else await expect(inspectNativeCommands(f.root,f.lease)).rejects.toThrow();
});
it('does not treat denied journal inspection as missing legacy evidence',async()=>{
 const f=await fixture();await initializeNativeEpoch(f.root,f.hash);vi.spyOn(fs,'lstat').mockRejectedValue(Object.assign(new Error('Native journal inspection denied'),{code:'EACCES'}));
 await expect(inspectNativeCommands(f.root,f.lease)).rejects.toThrow('Native journal inspection denied');
});
it.each(['parent-directory','epoch-directory','result-name','proof-name','proof-binding','inventory-bound'])('rejects unsafe %s journal structures',async fault=>{
 const f=await fixture();await initializeNativeEpoch(f.root,f.hash);
 if(fault==='parent-directory'||fault==='epoch-directory'){
  const directory=fault==='parent-directory'?path.join(f.root,'delivery-native'):f.directory;
  // Both paths were created inside this isolated mkdtemp fixture.
  expect(path.resolve(directory).startsWith(path.resolve(f.root)+path.sep)).toBe(true);await fs.rm(directory,{recursive:true});await fs.writeFile(directory,'not a directory');
 }else{
  await journalNativeCommand(f.root,f.hash,{executable:'pac',args:['solution','list']},f.root,undefined,async()=>{},async context=>{
   if(fault==='proof-name'||fault==='proof-binding')await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:fault==='proof-name'?crypto.randomUUID():context.id,intentSha256:fault==='proof-binding'?'0'.repeat(64):context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));
  });
  if(fault==='result-name'){const name=(await fs.readdir(f.directory)).find(name=>name.endsWith('.result.json'))!,file=path.join(f.directory,name),row=JSON.parse(await fs.readFile(file,'utf8'));row.id=crypto.randomUUID();await fs.writeFile(file,JSON.stringify(row));}
  if(fault==='inventory-bound')vi.spyOn(fs,'readdir').mockResolvedValue(Array.from({length:20001},(_,i)=>`${i}`) as never);
 }
 await expect(inspectNativeCommands(f.root,f.lease)).rejects.toThrow();
});
