import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fromBufferPromise} from 'yauzl';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {inspectSolutionPackage} from './packageInventory.ts';
import {stablePackageDigest} from './deliveryPackage.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {pinnedArtifactSchema,pinnedSourceSchema,localPreparationSchema,artifactPath,pinnedGitArgs,type LocalPreparation} from './pinnedPreparationContracts.ts';
import type {z} from 'zod';
export const digest=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
export async function readPinnedBlob(command:(args:string[])=>Promise<string>,commit:string,file:string){
 const entry=await command(pinnedGitArgs('entry',commit,file));
 if(!new RegExp(`^100644 blob [a-f0-9]{40,64}\\t${file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\x00$`).test(entry))throw new Error('Pinned source must be one exact regular non-executable blob');
 const value=await command(pinnedGitArgs('blob',commit,file));if(Buffer.byteLength(value)>8*1024*1024)throw new Error('Pinned source blob exceeds its bound');return value;
}
export async function collectPinnedPreparation(source:z.infer<typeof pinnedSourceSchema>,manifestText:string,manifest:{solutionZip:string;documentation:string[];recovery:{runbook:string;rehearsalReport?:string};preparation?:unknown},checkout:string,read:(file:string)=>Promise<string>){
 pinnedSourceSchema.parse(source);if(digest(manifestText)!==source.manifestSha256)throw new Error('Pinned manifest changed');
 const prep=pinnedArtifactSchema.parse(manifest.preparation),names=['cubefarm.delivery.json',...prep.files.map(file=>file.path),artifactPath.parse(manifest.solutionZip)];
 if(new Set(names.map(name=>name.toLowerCase())).size!==names.length||prep.packageBase64.toLowerCase()===manifest.solutionZip.toLowerCase()||names.some(name=>name.toLowerCase()===prep.packageBase64.toLowerCase()))throw new Error('Pinned artifact paths collide');
 for(const required of [...manifest.documentation,manifest.recovery.runbook,...(manifest.recovery.rehearsalReport?[manifest.recovery.rehearsalReport]:[])])if(!prep.files.some(file=>file.path===required))throw new Error('Pinned preparation omits a required reviewed file');
 const buffers=new Map<string,Buffer>([['cubefarm.delivery.json',Buffer.from(manifestText)]]);
 for(const file of prep.files){const bytes=Buffer.from(await read(file.path));if(digest(bytes)!==file.sha256)throw new Error('Pinned reviewed file changed');buffers.set(file.path,bytes);}
 const encoded=await read(prep.packageBase64);if(encoded.length>8*1024*1024)throw new Error('Pinned package exceeds its 6 MiB transport bound');
 const zip=Buffer.from(encoded,'base64');if(!zip.length||zip.length>6*1024*1024||zip.toString('base64')!==encoded||digest(zip)!==prep.packageSha256)throw new Error('Pinned package is not canonical or differs from approval');
 buffers.set(manifest.solutionZip,zip);
 const plan=localPreparationSchema.parse({kind:prep.kind,sourceCommit:source.sourceCommit,manifestSha256:source.manifestSha256,checkout:path.resolve(checkout),files:[...buffers].map(([file,bytes])=>({path:file,sha256:digest(bytes)}))});
 return {plan,buffers};
}
async function safeParent(root:string,file:string,create=false){
 if(!path.isAbsolute(root)||await fs.realpath(root)!==root)throw new Error('Preparation root must be a real private directory');
 artifactPath.parse(file);let current=root;for(const part of file.split('/').slice(0,-1)){current=path.join(current,part);if(create)await fs.mkdir(current).catch(error=>{if(error.code!=='EEXIST')throw error;});const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe preparation parent');}
 return path.join(root,...file.split('/'));
}
export async function materializePinnedPreparation(plan:LocalPreparation,buffers:Map<string,Buffer>){
 localPreparationSchema.parse(plan);await fs.mkdir(plan.checkout,{recursive:false});
 for(const file of plan.files){const bytes=buffers.get(file.path);if(!bytes||digest(bytes)!==file.sha256)throw new Error('Prepared source binding changed');const name=await safeParent(plan.checkout,file.path,true),handle=await fs.open(name,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
 await verifyLocalPreparation(plan);
 const manifest=parseUnambiguousJson(buffers.get('cubefarm.delivery.json')!.toString('utf8')) as {solutionZip:string};
 const inventory=await inspectSolutionPackage(path.join(plan.checkout,manifest.solutionZip));if(!inventory.archiveComplete||inventory.issues.length)throw new Error('Pinned ZIP inventory is incomplete or invalid');
 return inventory;
}
export async function verifyLocalPreparation(plan:LocalPreparation){
 localPreparationSchema.parse(plan);if(new Set(plan.files.map(file=>file.path.toLowerCase())).size!==plan.files.length)throw new Error('Preparation output aliases');
 for(const file of plan.files){const name=await safeParent(plan.checkout,file.path),stat=await fs.lstat(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||digest(await fs.readFile(name))!==file.sha256)throw new Error('Pinned preparation output changed');}
 if(plan.files.find(file=>file.path==='cubefarm.delivery.json')?.sha256!==plan.manifestSha256)throw new Error('Preparation manifest binding differs');
}
/** Empty-package exclusion only. No restore or app/data assurance is inferred. */
export async function verifyEmptySolution(file:string,solutionName:string){
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>6*1024*1024)throw new Error('Empty solution is not a bounded regular package');
 const expected=await stablePackageDigest(file),bytes=await fs.readFile(file);if(digest(bytes)!==expected)throw new Error('Empty solution changed while opening');
 const inventory=await inspectSolutionPackage(file);if(!inventory.archiveComplete||inventory.packageSha256!==expected||inventory.issues.length)throw new Error('Empty solution ZIP integrity could not be verified');
 const zip=await fromBufferPromise(bytes,{validateEntrySizes:true,strictFileNames:true});const entries=new Map<string,Buffer>();
 try{for await(const entry of zip.eachEntry()){if(entries.has(entry.fileName)||!['solution.xml','customizations.xml','[Content_Types].xml'].includes(entry.fileName)||entry.uncompressedSize>200000)throw new Error('Empty solution has unexpected package content');const chunks:Buffer[]=[];let size=0;for await(const chunk of await zip.openReadStreamPromise(entry)){size+=chunk.length;if(size>200000)throw new Error('Empty XML expansion limit');chunks.push(Buffer.from(chunk));}entries.set(entry.fileName,Buffer.concat(chunks));}}finally{zip.close();}
 if(entries.size!==3)throw new Error('Empty solution is incomplete');
 const parse=(name:string)=>{const xml=entries.get(name)!.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Unsafe empty solution XML');return new XMLParser({ignoreAttributes:false}).parse(xml).ImportExportXml;};
 const manifest=parse('solution.xml').SolutionManifest;
 if(manifest.UniqueName!==solutionName||Number(manifest.Managed)!==0||manifest.RootComponents!==''||manifest.MissingDependencies!=='')throw new Error('Solution is not an empty unmanaged package');
 const custom=parse('customizations.xml'),allowed=['Entities','Roles','Workflows','FieldSecurityProfiles','Templates','EntityMaps','EntityRelationships','OrganizationSettings','optionsets','CustomControls','EntityDataProviders'];
 for(const [key,value] of Object.entries(custom))if(!key.startsWith('@_')&&!(allowed.includes(key)&&value==='')&&!(key==='Languages'&&JSON.stringify(value)===JSON.stringify({Language:1033})))throw new Error('Empty solution contains application customizations');
 if(await stablePackageDigest(file)!==expected)throw new Error('Empty solution changed during validation');
 return {scope:'empty-solution-package-exclusion',solutionName,packageSha256:expected,applicationComponents:0,restorationVerified:false,deploymentOutcomeVerified:false,tenantMetadataMutation:true};
}
