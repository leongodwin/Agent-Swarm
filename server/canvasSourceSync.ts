import fs from 'node:fs/promises';
import type {BigIntStats} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';

const guid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
export const canvasSyncTargetSchema=z.strictObject({studioUrl:z.string().max(4096),environmentId:z.string().refine(v=>guid.safeParse(v.replace(/^Default-/i,'')).success),appId:guid,account:z.email().max(254)});
export type CanvasSyncTarget=z.infer<typeof canvasSyncTargetSchema>;
export interface CanvasSyncClient {call(tool:string,input:Record<string,unknown>,signal:AbortSignal):Promise<unknown>;close():Promise<void>}

/** The supported saved-app workflow, never the experimental new-blank path.
 * This validates requested identity, not tenant permissions or remote ownership. */
export function savedCanvasTarget(input:unknown){
 const target=canvasSyncTargetSchema.parse(input);let url:URL;try{url=new URL(target.studioUrl);}catch{throw new Error('A saved-app Studio edit URL is required');}
 if(url.protocol!=='https:'||url.hostname!=='make.powerapps.com'||url.port||url.username||url.password||url.hash)throw new Error('Use the approved production maker Studio edit URL');
 const match=/^\/e\/([^/]+)\/canvas\/?$/.exec(url.pathname);
 if(!match||decodeURIComponent(match[1]).toLowerCase()!==target.environmentId.toLowerCase())throw new Error('Studio environment does not match the intended target');
 const keys=[...url.searchParams.keys()];
 if(new Set(keys).size!==keys.length||keys.some(k=>!['action','app-id','referrer','source','template-name'].includes(k))||url.searchParams.get('action')!=='edit'||url.searchParams.has('template-name')&&!/^[a-z0-9_-]{1,100}$/i.test(url.searchParams.get('template-name')!))throw new Error('Use an unambiguous saved-app edit URL, not a new or join session');
 const value=url.searchParams.get('app-id')??'',app=/^(?:\/providers\/Microsoft\.PowerApps\/apps\/)?([a-f0-9-]{36})$/i.exec(value)?.[1];
 if(!app||!guid.safeParse(app).success||app.toLowerCase()!==target.appId.toLowerCase())throw new Error('Studio saved app ID does not match the intended target');
 return {environmentId:target.environmentId,appId:target.appId.toLowerCase(),account:target.account.toLowerCase()};
}

function nativeText(raw:unknown){
 if(typeof raw==='string'){if(Buffer.byteLength(raw)>256*1024)throw new Error('Oversized native response');return raw;}
 const result=z.object({isError:z.boolean().optional(),content:z.array(z.object({type:z.literal('text'),text:z.string()})).min(1).max(8)}).parse(raw);
 if(result.isError)throw new Error('Native tool reported an error');
 const text=result.content.map(c=>c.text).join('\n');if(Buffer.byteLength(text)>256*1024)throw new Error('Oversized native response');return text;
}
function connectedAccount(raw:unknown,expected:string){
 const accounts=nativeText(raw).split(/\r?\n/).flatMap(line=>/^\s*-\s+([^\s]+) \(connected\)\s*$/.exec(line)?.[1].toLowerCase()??[]);
 if(accounts.length!==1||accounts[0]!==expected)throw new Error('Native connected account differs or is ambiguous');
}
/** Observed saved-app native contract. Authentication-only experimental blank
 * replies cannot confirm a saved app, even when the account is correct. */
function savedConnection(raw:unknown,target:ReturnType<typeof savedCanvasTarget>){
 const match=/^Successfully connected for app: ([a-f0-9-]{36}), environment ([a-z0-9-]+)\. Signed in as: (\S+)\.(?: On any subsequent 'connect' call[^\r\n]*)?$/i.exec(nativeText(raw).trim());
 if(!match||match[1].toLowerCase()!==target.appId||match[2].toLowerCase()!==target.environmentId.toLowerCase()||match[3].toLowerCase()!==target.account)throw new Error('Native saved-app connection does not match the intended app, environment and account');
}
async function sourceFiles(directory:string){
 const entries=await fs.readdir(directory,{withFileTypes:true});
 if(entries.length>128)throw new Error('Source file count exceeds the diagnostic bound');
 const files=[];
 for(const entry of entries){
  if(!entry.isFile()||!/^[_a-zA-Z0-9][a-zA-Z0-9_. -]*\.pa\.yaml$/.test(entry.name))throw new Error('Sync returned unsafe or unexpected source entries');
  const file=path.join(directory,entry.name),before=await fs.lstat(file,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size===0n||before.size>1024n*1024n||await fs.realpath(file)!==file)throw new Error('Sync source is empty, linked or oversized');
  const handle=await fs.open(file,'r');let bytes:Buffer;
  try{
   const opened=await handle.stat({bigint:true});
   if(opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)throw new Error('Sync source identity changed before read');
   bytes=Buffer.alloc(Number(before.size));let offset=0;
   while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)throw new Error('Truncated sync source');offset+=read.bytesRead;}
   const after=await handle.stat({bigint:true}),entryNow=await fs.lstat(file,{bigint:true});
   if(before.ino!==entryNow.ino||before.dev!==entryNow.dev||entryNow.isSymbolicLink()||entryNow.nlink!==1n||before.size!==after.size||before.mtimeNs!==after.mtimeNs||await fs.realpath(file)!==file)throw new Error('Sync source changed during verification');
  }finally{await handle.close();}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0')||!text.trim())throw new Error('Sync source is not nonempty UTF-8 YAML');
  files.push({name:entry.name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 if(!files.some(f=>f.name==='App.pa.yaml')||!files.some(f=>f.name!=='App.pa.yaml'&&f.name!=='_EditorState.pa.yaml'))throw new Error('Sync did not return App.pa.yaml and a screen source');
 if(files.reduce((n,f)=>n+f.bytes,0)>16*1024*1024)throw new Error('Sync source exceeds the total bound');
 return files.sort((a,b)=>a.name.localeCompare(b.name));
}

/** Read-only provider diagnostic: fresh local source capture, no compile/apply,
 * create/save/publish, browser control, schema edits or approval. */
export async function verifyCanvasSourceSync(input:unknown,outputRoot:string,signal:AbortSignal,connect:(signal:AbortSignal)=>Promise<CanvasSyncClient>){
 const target=savedCanvasTarget(input);signal.throwIfAborted();
 const root=path.resolve(outputRoot),stat=await fs.lstat(root,{bigint:true});
 if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(root)!==root)throw new Error('Diagnostic output root must be an existing canonical directory');
 const captureDirectory=await fs.mkdtemp(path.join(root,'canvas-sync-')),captureIdentity=await fs.lstat(captureDirectory,{bigint:true}),directory=path.join(captureDirectory,'source');await fs.mkdir(directory);
 let sourceIdentity:BigIntStats|undefined;
 let client:CanvasSyncClient|undefined;
 const verifyDirectory=async()=>{
  for(const [file,expected] of [[root,stat],[captureDirectory,captureIdentity]] as const){const current=await fs.lstat(file,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||current.ino!==expected.ino||current.dev!==expected.dev||await fs.realpath(file)!==file)throw new Error('Diagnostic directory identity changed');}
  const current=await fs.lstat(directory,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||await fs.realpath(directory)!==directory||sourceIdentity&&(current.ino!==sourceIdentity.ino||current.dev!==sourceIdentity.dev))throw new Error('Diagnostic directory identity changed');
 };
 let stage='connect',failureCode:string|undefined,result:{files:Awaited<ReturnType<typeof sourceFiles>>}|undefined,failed=false,cleanupVerified=false;
 try{
  client=await connect(signal);signal.throwIfAborted();
  savedConnection(await client.call('connect',{environment_id:target.environmentId,app_id:target.appId,environment_category:'prod',login_hint:target.account},signal),target);signal.throwIfAborted();
  stage='account-before-sync';connectedAccount(await client.call('list_accounts',{},signal),target.account);signal.throwIfAborted();
  // The native sync recreates its destination. Allow that only for a fresh,
  // empty leaf inside an identity-pinned container; bind the resulting leaf
  // after the awaited native write, then reject every subsequent replacement.
  stage='source-sync';await verifyDirectory();if((await fs.readdir(directory)).length)throw new Error('Sync destination must start empty');signal.throwIfAborted();const rawSync=await client.call('sync_canvas',{directoryPath:directory},signal);signal.throwIfAborted();stage='source-sync-response';const sync=nativeText(rawSync);await verifyDirectory();sourceIdentity=await fs.lstat(directory,{bigint:true});await verifyDirectory();
  if(sync.includes('No files returned from server. Nothing written.'))throw new Error('Native source sync returned no files');
  stage='source-file-verification';
  const files=await sourceFiles(directory);
  stage='account-after-sync';connectedAccount(await client.call('list_accounts',{},signal),target.account);signal.throwIfAborted();
  stage='source-recheck';await verifyDirectory();if(JSON.stringify(files)!==JSON.stringify(await sourceFiles(directory)))throw new Error('Source changed after sync');await verifyDirectory();signal.throwIfAborted();
  result={files};
 }catch(error){failed=true;failureCode=error instanceof z.ZodError?'native-response-format':error instanceof Error&&error.message==='Diagnostic directory identity changed'?'capture-directory-changed':error instanceof Error&&error.message==='Native source sync returned no files'?'native-empty-sync':'native-or-source-verification-failed';}
 finally{if(client)try{await client.close();cleanupVerified=true;}catch{failed=true;stage='cleanup';}}
 if(!failed&&result&&cleanupVerified)try{await verifyDirectory();if(JSON.stringify(result.files)!==JSON.stringify(await sourceFiles(directory)))throw new Error('Source changed during cleanup');await verifyDirectory();signal.throwIfAborted();}catch{failed=true;stage='post-cleanup-source-recheck';}
 if(signal.aborted){failed=true;stage='interrupted';}
 return {schemaVersion:1,scope:'canvas-source-sync-diagnostic-only',observedAt:new Date().toISOString(),target,captureDirectory,directory,status:!failed&&result&&cleanupVerified?'source-sync-observed':'blocked',stage,failureCode,sourceSyncObserved:!failed&&!!result&&cleanupVerified,cleanupVerified,files:result?.files??[],authoringApproved:false,runtimeVerified:false,targetBinding:'validated saved edit URL and matching native connect app/environment/account; no independent tenant permission readback',limits:['Studio must remain open with coauthoring enabled','Source files are not compile, source-schema, permission, runtime or deployment acceptance','No existing working source was overwritten; capture is retained for inspection']};
}
