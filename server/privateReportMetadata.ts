import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import type {DeliveryDependencies} from './delivery.ts';
const nativeRun:DeliveryDependencies['run']=async(...args)=>(await import('./delivery.ts')).deliveryCommands.run(...args);
import {parseUnambiguousJson} from './unambiguousJson.ts';
/** A fixed Windows ACL observation, never a caller-selected file or a repair. */
export async function privateReportMetadata(recordId:string,cwd:string,signal:AbortSignal,guard:()=>void,deps={run:nativeRun,home:os.homedir(),platform:process.platform,stat:fs.lstat,realpath:fs.realpath}){
 const check=()=>{signal.throwIfAborted();guard();};check();
 try{
  z.uuid().parse(recordId);if(deps.platform!=='win32')throw Error();
  const root=path.resolve(deps.home),parts=['.cubefarm','private-flow-reports','recruitment-e2e-'+recordId];let leaf=root;
  for(const part of parts){leaf=path.join(leaf,part);const stat=await deps.stat(leaf);check();if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await deps.realpath(leaf)).toLowerCase()!==leaf.toLowerCase())throw Error();}
  const literal=leaf.replace(/'/g,"''");
  const script=`$ErrorActionPreference='Stop'; $env:PSModulePath=[System.IO.Path]::Combine($PSHOME,'Modules'); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $a=Get-Acl -LiteralPath '${literal}'; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; currentUser=$u; protected=$a.AreAccessRulesProtected; rules=@($a.Access|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; rights=[int]$_.FileSystemRights; type=[string]$_.AccessControlType; inherited=$_.IsInherited; inheritance=[int]$_.InheritanceFlags; propagation=[int]$_.PropagationFlags}})}|ConvertTo-Json -Depth 5 -Compress`;
  const raw=await deps.run({executable:'powershell',args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]},cwd,{},signal);check();
  const sid=z.string().regex(/^S-1-\d+(?:-\d+)+$/),acl=z.object({owner:sid,currentUser:sid,protected:z.boolean(),rules:z.array(z.object({sid,rights:z.number().int(),type:z.string(),inherited:z.boolean(),inheritance:z.number().int(),propagation:z.number().int()})).max(32)}).parse(parseUnambiguousJson(raw,{maxBytes:16384}));
  const expected=[acl.currentUser,'S-1-5-18','S-1-5-32-544'];
  const protectedOwnerOnly=acl.owner===acl.currentUser&&acl.protected&&acl.rules.length===3&&new Set(expected).size===3&&expected.every(value=>acl.rules.filter(r=>r.sid===value&&r.type==='Allow'&&r.rights===2032127&&!r.inherited&&r.inheritance===3&&r.propagation===0).length===1);
  // Revalidate every directory after the native read; no content is enumerated.
  leaf=root;for(const part of parts){leaf=path.join(leaf,part);const stat=await deps.stat(leaf);check();if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await deps.realpath(leaf)).toLowerCase()!==leaf.toLowerCase())throw Error();}
  return{status:'observed',scope:'private-report-acl-metadata',recordId,leaf,protectedOwnerOnly,acl,contentsRead:false,writeVerified:false,retentionVerified:false,logSuppressionVerified:false,limits:['Directory and ACL metadata only; no report content, filenames, writes or permission changes','Runtime capture, retention and suppression of private data in shared logs require independent validation']};
 }catch{check();return{status:'unavailable',scope:'private-report-acl-metadata',recordId,reason:'Fixed Windows private leaf unavailable or changed; no repair performed'};}
}

