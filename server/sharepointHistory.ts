import fs from 'node:fs/promises';
import path from 'node:path';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {journalSchema,sharepointHash,sharepointPlan,type SharepointPlan} from './sharepointProvisioning.ts';

/** Project journals share the original site lease. Never move/adopt foreign
 * history, and never start a new project past an unresolved foreign operation. */
export async function projectSharepointHistory(leaseRoot:string,siteId:string,repoId:string,guard:()=>void){
 if(!repoId||repoId.length>200)throw Error('Project history identity unavailable');
 const history=path.join(leaseRoot,'sharepoint-history'),projects=path.join(history,'projects'),directory=path.join(projects,sharepointHash(repoId)),name=sharepointHash(siteId.toLowerCase())+'.json';
 const ensure=async(file:string)=>{guard();try{await fs.mkdir(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const st=await fs.lstat(file);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Unsafe SharePoint history directory');guard();};
 const checkDirectory=async(file:string)=>{const st=await fs.lstat(file);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Unsafe SharePoint history directory');guard();};
 await checkDirectory(leaseRoot);for(const file of [history,projects,directory])await ensure(file);
 const bytes=async(file:string,max:number)=>{guard();let st;try{st=await fs.lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||await fs.realpath(file)!==path.resolve(file))throw Error('Unsafe SharePoint history file');const raw=await readBoundedBytes(file,max);if(!raw)throw Error('SharePoint history exceeds bound');guard();return raw;};
 const snapshot=async()=>{
  for(const file of [history,projects,directory])await checkDirectory(file);
  const dirs=await fs.readdir(projects,{withFileTypes:true});if(dirs.length>100)throw Error('Too many project histories');
  const candidates:[string,string|undefined][]=[[path.join(history,name),undefined]];
  for(const dir of dirs.sort((a,b)=>a.name.localeCompare(b.name))){if(!/^[a-f0-9]{64}$/.test(dir.name)||!dir.isDirectory()||dir.isSymbolicLink())throw Error('Unsafe SharePoint project history');const parent=path.join(projects,dir.name);await checkDirectory(parent);if(parent!==directory)candidates.push([path.join(parent,name),dir.name]);}
  const fingerprints=[];let totalBytes=0;
  for(const [file,ownerHash] of candidates){const raw=await bytes(file,64*1024);if(!raw)continue;
   totalBytes+=raw.length;if(totalBytes>2*1024*1024)throw Error('Foreign SharePoint history exceeds total bound');
   const journal=journalSchema.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(raw),{maxBytes:64*1024}));
   const owner=parseUnambiguousJson(journal.authority,{maxBytes:4000}) as {repoId?:string;planSha256?:string};
   if(!owner||typeof owner.repoId!=='string'||!owner.repoId||owner.repoId===repoId||owner.planSha256!==journal.planSha256||ownerHash&&ownerHash!==sharepointHash(owner.repoId))throw Error('Foreign SharePoint history ownership is unresolved');
   if(new Set(journal.entries.map(e=>e.key)).size!==journal.entries.length||new Set(journal.entries.map(e=>e.id?.toLowerCase())).size!==journal.entries.length||journal.entries.some(e=>e.status!=='verified'||!e.id))throw Error('Foreign SharePoint write outcome is unresolved');
   const proofs=[];
   for(const entry of journal.entries){
    if(!entry.migration){if(!entry.marker.startsWith('CubeFarm:'+journal.planSha256+':'))throw Error('Foreign SharePoint marker differs');continue;}
    const proofFile=path.join(leaseRoot,'sharepoint-reconciliations',entry.migration+'.json');await checkDirectory(path.dirname(proofFile));
    const proof=await bytes(proofFile,128*1024);if(!proof)throw Error('Foreign SharePoint migration proof unavailable');
    totalBytes+=proof.length;if(totalBytes>2*1024*1024)throw Error('Foreign SharePoint history exceeds total bound');
    const {receiptSchema,verifySchemaLineage}=await import('./sharepointReconciliation.ts');
    const receipt=receiptSchema.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(proof),{maxBytes:128*1024}));
    if(receipt.phase!=='applied'||sharepointHash(receipt.binding)!==entry.migration||receipt.binding.planSha256!==journal.planSha256||receipt.binding.authority!==journal.authority)throw Error('Foreign SharePoint migration is unresolved');
    // Reconstruct only the existing supported text-facet correction, then use
    // the SAME full lineage validator as the legacy journal path.
    const historical=structuredClone(receipt.binding.spec.originalPlan) as unknown as SharepointPlan;
    for(const resource of historical.resources)for(const column of resource.columns)if(column.kind==='text'&&column.multiline)delete column.maxLength;
    await verifySchemaLineage(leaseRoot,sharepointPlan.parse(historical),journal.authority,entry,guard);
    proofs.push(sharepointHash(proof.toString('base64')));
   }
   fingerprints.push({file,sha256:sharepointHash(raw.toString('base64')),proofs});
  }
  // Reject links even for this project's own retained file before later writes.
  await bytes(path.join(directory,name),64*1024);guard();return JSON.stringify(fingerprints);
 };
 const baseline=await snapshot();
 return{file:path.join(directory,name),check:async()=>{if(await snapshot()!==baseline)throw Error('Foreign SharePoint history changed');}};
}
