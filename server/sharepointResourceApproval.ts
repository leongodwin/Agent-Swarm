import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {pinWriteTargetProposal} from './sharepointWriteReadiness.ts';
import {sharepointHash} from './sharepointProvisioning.ts';

/** Server-operator assertion only; never substitutes for independent design/task governance. */
export const writeTargetApproval=z.strictObject({schemaVersion:z.literal(1),repoId:z.string().min(1).max(200),proposalSha256:z.string().regex(/^[a-f0-9]{64}$/),planSha256:z.string().regex(/^[a-f0-9]{64}$/),approvedBy:z.email(),decision:z.literal('approved'),operations:z.union([z.tuple([z.literal('create-schema')]),z.tuple([z.literal('continue-applied-schema'),z.literal('create-schema')]),z.tuple([z.literal('reconcile-owned-schema'),z.literal('create-schema')])]),observedAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
export async function assertWriteTargetApproval(root:string,repoId:string,binding:{tenantId:string;username:string},planSha256:string,guard:()=>void,operations:readonly string[]=['create-schema']){
 const pinned=await pinWriteTargetProposal(root,repoId,binding,guard),file=path.join(root,'write-target-approval.json');
 const read=async()=>{guard();const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Resource approval path differs');const bytes=await readBoundedBytes(file,16384);if(!bytes)throw Error('Resource approval absent');guard();return bytes;};
 let raw:Buffer;try{raw=await read();}catch{guard();throw Error('Explicit server-owned dedicated resource approval required');}
 const approval=writeTargetApproval.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(raw),{maxBytes:16384}));
 const check=()=>{guard();const start=Date.parse(approval.observedAt),end=Date.parse(approval.expiresAt),now=Date.now();if(JSON.stringify(approval.operations)!==JSON.stringify(operations)||approval.repoId!==repoId||approval.proposalSha256!==sharepointHash(pinned.proposal)||approval.planSha256!==planSha256||approval.approvedBy.toLowerCase()!==binding.username.toLowerCase()||start>now||end<=now||end<=start||end-start>86400000)throw Error('Dedicated resource approval binding or validity differs');};
 const owned=async()=>{check();await pinned.owned();if(!raw.equals(await read()))throw Error('Dedicated resource approval changed');check();};await owned();return{approval,owned};
}
