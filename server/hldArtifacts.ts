import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {hldArtifactSchema,hldInputSchema,hldResultSchema,type HldArtifact} from '../shared/hldArtifact.ts';
import type {HldInput,HldResult} from '../shared/hld.ts';
import {atomicWrite,SerialWriter} from './atomicFile.ts';
import {readBoundedJson,readBoundedText} from './boundedJson.ts';
import {HttpError} from './httpError.ts';
const pointerSchema=z.strictObject({schemaVersion:z.literal(1),docId:hldResultSchema.shape.docId,sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const writers=new Map<string,{writer:SerialWriter;active:number}>();
const digest=(repoId:string|null,input:HldArtifact['input'],result:HldArtifact['result'])=>crypto.createHash('sha256').update(JSON.stringify({repoId,input,result})).digest('hex');
function contained(root:string,target:string){const relative=path.relative(root,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw new HttpError(400,'Architecture artifact must stay inside the repository');return target;}
async function directory(root:string,create:boolean,guard:()=>void){
  let current=root;
  for(const segment of ['docs','architecture','drafts']){
    guard();const next=path.join(current,segment);
    let resolved=await fs.realpath(next).catch(async error=>{
      if(error.code!=='ENOENT')throw error;if(!create)return undefined;
      guard();await fs.mkdir(next).catch(error=>{if(error.code!=='EEXIST')throw error;});return fs.realpath(next);
    });
    guard();if(!resolved)return undefined;current=contained(root,resolved);
  }
  return current;
}
async function file(root:string,dir:string,name:string){return contained(root,await fs.realpath(path.join(dir,name)));}
async function readArtifact(root:string,dir:string,docId:string,sha256:string,guard:()=>void):Promise<HldArtifact>{
  const artifact=hldArtifactSchema.parse(await readBoundedJson(await file(root,dir,`${docId}.json`),8*1024*1024));guard();
  if(artifact.result.docId!==docId||artifact.sha256!==sha256||digest(artifact.repoId,artifact.input,artifact.result)!==sha256)throw new HttpError(409,'Saved architecture artifact integrity differs');
  const markdown=await readBoundedText(await file(root,dir,`${docId}.md`),1024*1024);guard();
  if(markdown!==artifact.result.markdownContent)throw new HttpError(409,'Saved architecture Markdown differs from its artifact');
  return artifact;
}
export async function loadLatestHld(repoPath:string,guard:()=>void=()=>{},repoId?:string):Promise<HldArtifact|null>{
  guard();const root=await fs.realpath(repoPath);guard();const dir=await directory(root,false,guard);if(!dir)return null;
  try{
    const pointerPath=path.join(dir,'current.json');
    const exists=await fs.lstat(pointerPath).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});guard();if(!exists)return null;
    const pointer=pointerSchema.parse(await readBoundedJson(await file(root,dir,'current.json'),4096));guard();const artifact=await readArtifact(root,dir,pointer.docId,pointer.sha256,guard);
    if(repoId&&artifact.repoId!==repoId)throw new HttpError(409,'Saved architecture draft belongs to another repository');return artifact;
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(409,'Saved architecture draft is unreadable; preserve its files before repair');}
}
export async function loadHldVersion(repoPath:string,repoId:string,docId:string,sha256:string,guard:()=>void=()=>{}):Promise<HldArtifact>{
  hldResultSchema.shape.docId.parse(docId);pointerSchema.shape.sha256.parse(sha256);guard();
  const root=await fs.realpath(repoPath);guard();const dir=await directory(root,false,guard);
  if(!dir)throw new HttpError(404,'Architecture version is unavailable');
  const artifact=await readArtifact(root,dir,docId,sha256,guard);
  if(artifact.repoId!==repoId)throw new HttpError(409,'Architecture version belongs to another project');return artifact;
}
export async function saveHldArtifact(repoPath:string,input:HldInput,result:HldResult,guard:()=>void=()=>{},repoId?:string):Promise<HldResult>{
  guard();const root=await fs.realpath(repoPath);guard();let entry=writers.get(root);if(!entry){entry={writer:new SerialWriter(),active:0};writers.set(root,entry);}const owner=entry;owner.active++;
  try{return await owner.writer.write(async()=>{
    guard();const dir=(await directory(root,true,guard))!;
    await loadLatestHld(repoPath,guard,repoId);
    const {repoPath:_path,...requirements}=input;
    const parsedInput=hldInputSchema.parse(requirements),parsedResult=hldResultSchema.parse(result);
    const scope=repoId??null,sha256=digest(scope,parsedInput,parsedResult),artifact=hldArtifactSchema.parse({schemaVersion:1,repoId:scope,input:parsedInput,result:parsedResult,sha256});
    const json=JSON.stringify(artifact,null,2);
    if(Buffer.byteLength(parsedResult.markdownContent)>1024*1024||Buffer.byteLength(json)>8*1024*1024)throw new HttpError(413,'Architecture artifact exceeds its storage bound');
    for(const extension of ['md','json'])if(await fs.lstat(path.join(dir,`${result.docId}.${extension}`)).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw new HttpError(409,'Architecture document identity already exists; generate a new version');
    const current=()=>{guard();return true;};
    await atomicWrite(path.join(dir,`${result.docId}.md`),result.markdownContent,current);guard();
    await atomicWrite(path.join(dir,`${result.docId}.json`),json,current);guard();
    await readArtifact(root,dir,result.docId,sha256,guard);
    await atomicWrite(path.join(dir,'current.json'),JSON.stringify({schemaVersion:1,docId:result.docId,sha256}),current);guard();
    return {...result,savedFilePath:path.join(dir,`${result.docId}.md`),artifactSha256:sha256};
  });}finally{if(--owner.active===0&&writers.get(root)===owner)writers.delete(root);}
}
