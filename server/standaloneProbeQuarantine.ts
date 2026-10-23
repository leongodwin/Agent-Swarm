import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {standaloneProbePlanSchema,type StandaloneProbePlan} from './standaloneMetadataProbe.ts';
import {connectorProbeDigest} from './connectorMetadataProbe.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const names=['intent.json','000-create-publishers-intent.json','001-created-publishers.json','002-create-solutions-intent.json','003-created-solutions.json','004-create-connectionreferences-intent.json','005-created-connectionreferences.json','006-create-flow-intent.json','007-created-flow.json','008-add-membership-intent.json'].sort();
const digest=(bytes:Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
async function read(file:string,expected:string){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.resolve(file))throw Error('Original quarantine evidence is not canonical');
 const bytes=await readBoundedBytes(file,65536);if(!bytes||digest(bytes)!==expected)throw Error('Original quarantine evidence changed');
 return parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(bytes),{maxBytes:65536});
}

/** Read-only fence. It neither clears the old lease nor proves provider settlement.
 * A separate exact review must establish operation isolation before replacement
 * creation. No stale/dead-owner reclamation, directory repair or file writes. */
export async function verifyStandaloneQuarantine(raw:StandaloneProbePlan,home:string,repoId:string){
 const p=standaloneProbePlanSchema.parse(raw),q=p.quarantine;
 const scope=connectorProbeDigest({tenant:p.identity.tenantId,environment:p.identity.environmentId,repo:repoId,record:p.record.id});
 const index=z.object({scope:hash,resource:z.string(),files:z.array(z.object({name:z.enum(names as [string,...string[]]),sha256:hash})).length(10),lease:z.object({sha256:hash,resource:z.string(),owner:hash,pid:z.number().int().positive(),acquiredAt:z.string()})}).parse(await read(path.join(home,'original-probe-failure-index.json'),q.indexSha256));
 if(index.scope!==scope||index.resource!=='connector-probe:'+index.scope||index.lease.resource!==index.resource||index.lease.sha256!==q.leaseSha256||new Set(index.files.map(f=>f.name)).size!==10)throw Error('Original quarantine resource identity differs');
 const root=path.join(home,'planning','connector-probe-executions',index.scope);
 if(await fs.realpath(root)!==path.resolve(root)||JSON.stringify((await fs.readdir(root)).sort())!==JSON.stringify(names))throw Error('Original complete execution journal changed');
 const rows=new Map<string,unknown>();for(const item of index.files)rows.set(item.name,await read(path.join(root,item.name),item.sha256));
 const intent=z.object({record:z.object({id:z.literal(p.record.id)}),proposalSha256:z.literal(index.lease.owner),businessAuthorityGranted:z.literal(false),messageAccessAllowed:z.literal(false),sendAllowed:z.literal(false),releaseStartedAt:z.iso.datetime(),startedAt:z.iso.datetime(),pid:z.literal(index.lease.pid)}).parse(rows.get('intent.json'));
 for(const row of rows.values())z.object({proposalSha256:z.literal(intent.proposalSha256)}).parse(row);
 if(Date.parse(intent.releaseStartedAt)+3600000>Date.now())throw Error('Original attempt release window has not expired; do not overlap it');
 const made=z.object({stage:z.literal('created-flow'),proposalSha256:z.literal(intent.proposalSha256),flowId:z.literal(q.flowId),publisherId:z.literal(q.publisherId),solutionId:z.literal(q.solutionId),referenceId:z.literal(q.referenceId)}).parse(rows.get('007-created-flow.json'));
 z.object({stage:z.literal('add-membership-intent'),proposalSha256:z.literal(intent.proposalSha256),ComponentId:z.literal(made.flowId),ComponentType:z.literal(29),SolutionUniqueName:z.literal('ASRecruitmentE2E'),AddRequiredComponents:z.literal(false),solutionId:z.literal(made.solutionId)}).parse(rows.get('008-add-membership-intent.json'));
 const leaseFile=path.join(home,'resource-leases',crypto.createHash('sha256').update(index.resource).digest('hex')+'.json');
 z.object({resource:z.literal(index.resource),owner:z.literal(index.lease.owner),pid:z.literal(index.lease.pid),acquiredAt:z.literal(index.lease.acquiredAt)}).parse(await read(leaseFile,q.leaseSha256));
 try{process.kill(index.lease.pid,0);throw Error('Original local owner is still alive; preserve its operation fence');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
 return {indexSha256:q.indexSha256,originalScope:index.scope,originalResource:index.resource,originalLeaseSha256:q.leaseSha256,originalJournalSha256:connectorProbeDigest(index.files),oldFlowId:made.flowId,originalReleaseStartedAt:intent.releaseStartedAt,originalActivationOrTriggerIntent:false,originalHoldPreserved:true,providerMembershipSettlementVerified:false,replayAuthorized:false,tenantAuthorityGranted:false};
}
