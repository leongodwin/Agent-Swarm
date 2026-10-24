import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {readBoundedBytes} from './boundedJson.ts';
import {hostReviewCapsule} from './nativeReviewCapsule.ts';

const sha=(value:string|Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex');
/** Fixed complete callsites, not caller-selected excerpts. Whole-file hashes also
 * bind surrounding code; line endings and every selected byte remain exact. */
export function exactHostSection(file:string,text:string,start:string,end?:string){
 const at=text.indexOf(start);if(at<0||text.indexOf(start,at+start.length)>=0)throw Error('Host review start is absent or ambiguous');
 let through:number;
 if(end){through=text.indexOf(end,at+start.length);if(through<0||text.indexOf(end,through+end.length)>=0)throw Error('Host review end is absent or ambiguous');}
 else{through=text.indexOf('\n',at);if(through<0)through=text.length;else through++;}
 const selected=text.slice(at,through);if(!selected||Buffer.byteLength(selected)>128*1024)throw Error('Host review component exceeds its existing bound');
 return {file,fullSourceSha256:sha(text),startCharacter:at,endCharacter:through,sha256:sha(selected),text:selected};
}
const sections=[
 ['server/flowAdapter.ts',"import crypto from 'node:crypto';",'export async function verifyCloudFlowContext('],
 ['server/resourceLease.ts',"import fs from 'node:fs/promises';",'export async function withResourceLease<T>('],
 ['server/tenancy.ts',"import fs from 'node:fs';"],
 ['server/tenancy.ts',"import path from 'node:path';"],
 ['server/tenancy.ts',"import { resolveCommand, unwrapCmdShim } from './clis.ts';"],
 ['server/tenancy.ts',"import { HttpError } from './httpError.ts';"],
 ['server/tenancy.ts','export function resolveTenancyCommand(','export interface TenancyRunner'],
 ['server/clis.ts',"import fs from 'node:fs';"],
 ['server/clis.ts',"import path from 'node:path';"],
 ['server/clis.ts',"const WIN = process.platform === 'win32';",'/** How to start a CLI:'],
 ['server/index.ts','const standaloneProbeFor=','const packagingFor='],
 ['server/index.ts','const recordDependencies=','const sourceReaderFor='],
 ['server/index.ts','const {app,browserAuth,closeAdmission}=createOfficeHttpApp('],
 ['server/officeHttp.ts','export function createOfficeHttpApp','  app.get(\'/api/repos/:repo/reliability\''],
 ['server/officeHttp.ts','  app.get(\'/api/repos/:repo/standalone-probe\'','  app.get(\'/api/repos/:repo/canvas-packaging\''],
 ['server/officeHttp.ts','  app.post(\'/api/repos/:repo/target\''],
 ['server/ceo.ts','export type RecordToolHandler =','function skillTools()'],
 ['server/swarm.ts','  async reviewDeliveryRelease(','  requestReview()'],
 ['server/swarm.ts','  async refreshRepoTarget(','  updateRepo('],
 ['server/delivery.ts','export const deliveryCommands: DeliveryDependencies = {','const canonical ='],
 ['server/delivery.ts','export function pacReportedError(','export function importJobId('],
 ['server/targetOperations.ts',"import { z } from 'zod';"],
 ['server/targetOperations.ts','export const dataverseGuid =','export const targetComponentSchema'],
 ['server/targetOperations.ts','export async function verifyTarget(','/** Complete bounded membership inventory;'],
] as const;
export async function standaloneHostReviewSources(){
 const read=async(file:string)=>{const name=fileURLToPath(new URL('../'+file,import.meta.url)),stat=await fs.lstat(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Canonical host source required');const bytes=await readBoundedBytes(name,512*1024);if(!bytes)throw Error('Host source unavailable');return new TextDecoder('utf8',{fatal:true}).decode(bytes);};
 const files=[...new Set([...sections.map(s=>s[0]),'server/deliveryRecordTools.ts','server/browserAuth.ts'])];
 const snapshots=new Map(await Promise.all(files.map(async file=>[file,await read(file)] as const)));
 const sources=sections.map(section=>exactHostSection(section[0],snapshots.get(section[0])!,section[1],section[2]));
 for(const file of ['server/deliveryRecordTools.ts','server/browserAuth.ts']){const text=snapshots.get(file)!;sources.push({file,fullSourceSha256:sha(text),startCharacter:0,endCharacter:text.length,sha256:sha(text),text});}
 await Promise.all(files.map(async file=>{if(await read(file)!==snapshots.get(file))throw Error('Host source changed during review assembly');}));
 const text=hostReviewCapsule(sources);
 if(Buffer.byteLength(text)>128*1024)throw Error('Host source capsule exceeds the existing review bound');
 return {file:'docs/STANDALONE-NORMAL-HOST-SOURCES.md',sha256:sha(text),text};
}
