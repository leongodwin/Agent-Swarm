import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectDeliveryRecovery} from '../deliveryRecovery.ts';
export const guid='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
export const environmentUrl='https://synthetic.crm4.dynamics.com';
export const target={environmentUrl,binding:{organizationId:guid,userId:guid},identity:{tenantId:guid,environmentId:guid,username:'synthetic@example.test'}};
export async function seedRetainedCloud(root:string,edit?:(state:any)=>void){
 const plan={acceptanceProfile:'functional-development',name:'Synthetic',owner:'ada',qaOwner:'sherlock',requiredIssues:[1],components:['Data'],acceptanceCriteria:['Read records'],quality:{maxTaskDurationMs:1000,maxSeriousAccessibilityIssues:0},monitoring:{intervalMinutes:5,criticalProbeIds:['read']},verification:{baseUrl:environmentUrl,identities:[],scenarios:[],api:{binding:target.binding,checks:['journey','authorization','persistence','error-handling'].map(category=>({name:`Check ${category}`,criterion:0,category,resource:'WhoAmI',assertions:[{pointer:['OrganizationId'],equals:guid}]}))}}};
 const head='a'.repeat(40),startedAt='2026-01-01T00:00:00.000Z';
 const release={id:'release',repoId:'synthetic/repo',head,environmentUrl,plan,planHash:crypto.createHash('sha256').update(JSON.stringify({plan,head,environmentUrl})).digest('hex'),createdAt:startedAt,approvedAt:startedAt,approvedBy:'sherlock'};
 const state:any={schemaVersion:1,policy:{environmentUrl,enabled:true,approvedAt:startedAt},releases:[release],runs:[{id:'run',releaseId:'release',repoId:release.repoId,head,environmentUrl,phase:'deploying',startedAt,appUrls:[],evidence:[],log:[],solution:'Synthetic',checkpoint:'import-started',recovery:{inventoryFile:'inventory.json',runbook:'runbook.md',drillReport:'drill.json',packageSha256:'b'.repeat(64)},operations:[{id:'solution-import',kind:'import',status:'unknown',commandSha256:'c'.repeat(64),startedAt,platformJobId:job}]}],blockers:[],revision:1};
 edit?.(state);const bytes=JSON.stringify(state);const lease=JSON.stringify({schemaVersion:1,pid:2147483647,token:crypto.randomUUID(),acquiredAt:startedAt});
 await fs.writeFile(path.join(root,'delivery.json'),bytes);await fs.writeFile(path.join(root,'delivery.lock'),lease);
 const inspection=await inspectDeliveryRecovery(root);
 const row={importjobid:job,solutionname:'Synthetic',progress:100,startedon:'2026-01-01T00:00:01.000Z',completedon:'2026-01-01T00:01:00.000Z'};
 return {bytes,lease,target,row,job,input:{snapshotSha256:inspection.snapshotSha256!,targets:[target]}};
}
