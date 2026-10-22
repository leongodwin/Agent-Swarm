import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {RuntimeCleanupStore} from './runtimeCleanup.ts';
const sha=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9-]{36}$/;
function plain(file:string,max:number){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max)throw Error('Recovery evidence is not a bounded regular file');return fs.readFileSync(file);}
/** This is not an adoption path. Only the exact original instruction bytes plus
 * Codex's native formatting and one already-authorized project-trust row qualify. */
export function inspectNativeTrustDrift(directory:string,projects:string[]){
 const marker=plain(path.join(directory,'codex-instruction-profile.json'),4096),journal=JSON.parse(marker.toString('utf8'));
 if(!/^cubefarm-instructions-[a-f0-9-]{36}$/.test(journal.name)||!path.isAbsolute(journal.home)||!/^[a-f0-9]{64}$/.test(journal.sha256))throw Error('Invalid retained profile provenance');
 const file=path.join(journal.home,journal.name+'.config.toml'),bytes=plain(file,1024*1024),text=bytes.toString('utf8');
 const match=/^developer_instructions(?:=| = )("(?:\\.|[^"\\])*")\n\n\[projects\.'([^'\r\n]+)'\]\ntrust_level = "trusted"\n$/.exec(text);
 if(!match)throw Error('Profile differs from the supported native trust transformation');
 const instructions=JSON.parse(match[1]);
 if(sha('developer_instructions='+JSON.stringify(instructions)+'\n')!==journal.sha256)throw Error('Original instruction hash does not match');
 const canonical=(value:string)=>{const real=fs.realpathSync.native(value);return process.platform==='win32'?real.toLowerCase():real;};
 if(!projects.some(project=>canonical(project)===match[2]))throw Error('Native trust scope is not an authorized project');
 return {name:journal.name,file,journalSha256:sha(marker),originalSha256:journal.sha256,observedSha256:sha(bytes),project:match[2]};
}
function noProfileProcesses(names:string[]){
 if(process.platform!=='win32')throw Error('Native profile recovery currently supports Windows only');
 const script="$names=@([Console]::In.ReadToEnd()|ConvertFrom-Json); $hits=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $line=$_.CommandLine; $line -and @($names | Where-Object {$line.Contains($_)}).Count -gt 0 }); if($hits.Count -gt 0){exit 9}; Write-Output 'NO_PROFILE_PROCESS'";
 const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify(names),encoding:'utf8',windowsHide:true,timeout:15000,stdio:['pipe','pipe','pipe']});
 if(result.trim()!=='NO_PROFILE_PROCESS')throw Error('Native process inventory was not verified');
}
function durable(file:string,value:unknown){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function profileRecovery(root:string,projects:string[],guard:()=>void,input:{proposalSha256?:string},inventory=noProfileProcesses){
 guard();const store=new RuntimeCleanupStore(path.join(root,'runtime-cleanup.json')),view=store.view();
 if(view.unavailableReason||!view.records.length)throw Error('No readable profile quarantine to reconcile');
 const entries=view.records.map(record=>{if(!record.id.startsWith('profile-')||record.pid!==0||record.keeperInstance!==null||record.state!=='unverified'||!uuid.test(record.id.slice(8)))throw Error('Recovery contains a non-profile cleanup obligation');const directory=path.join(root,'sessions',record.id.slice(8));return{record,directory,profile:inspectNativeTrustDrift(directory,projects)};});
 inventory(entries.map(entry=>entry.profile.name));guard();
 const proposal={scope:'archive-known-native-project-trust-drift',entries},proposalSha256=sha(JSON.stringify(proposal));
 if(!input.proposalSha256)return{proposalSha256,proposal};
 if(input.proposalSha256!==proposalSha256)throw Error('Recovery proposal changed');
 // Each receipt precedes the archive. Any interruption retains quarantine; it
 // never authorizes replay or deletion of unknown profile bytes.
 for(const entry of entries){guard();const current=inspectNativeTrustDrift(entry.directory,projects);if(JSON.stringify(current)!==JSON.stringify(entry.profile))throw Error('Profile changed before archive');
  const archive=path.join(entry.directory,'native-trust-profile.archived.toml');
  durable(path.join(entry.directory,'native-trust-recovery.json'),{schemaVersion:1,proposalSha256,entry,observedAt:new Date().toISOString(),method:'native-process-inventory-and-exact-trust-drift'});
  fs.renameSync(entry.profile.file,archive);if(sha(plain(archive,1024*1024))!==entry.profile.observedSha256)throw Error('Archived profile differs');
  guard();store.confirmed(entry.record.id);if(store.view().unavailableReason)throw Error('Quarantine acknowledgement was not saved');
 }
 return {proposalSha256,archived:entries.length,remaining:store.view().records.length};
}
