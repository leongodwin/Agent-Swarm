import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./handoffMutex.ts',()=>({withHandoffMutex:async(_root:string,work:(owned:()=>void)=>Promise<unknown>)=>work(()=>{})}));
import {claimHeadlessRun} from './headlessRunBarrier.ts';
import {reconcileHeadlessVerificationRun} from './headlessFlowVerification.ts';
import type {FlowAdapter} from './flowAdapter.ts';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const recordId='11111111-1111-4111-8111-111111111111',flowId='22222222-2222-4222-8222-222222222222',tenantId='33333333-3333-4333-8333-333333333333',environmentId='44444444-4444-4444-8444-444444444444',owner='owner@example.test';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
it.each(['verified','cancelled','no-started-with-id','missing-id','nonterminal','wrong-nonce','wrong-mode','wrong-data','wrong-record','wrong-caller','foreign-run','future','changed-definition','changed-hold','revoked','journal-disagrees'])('reconciles only original correlated terminal evidence and preserves all other holds: %s',async mode=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');const root=await fs.mkdtemp(path.join(os.tmpdir(),'original-headless-'));roots.push(root);
 const definition={triggers:{manual:{type:'Request',kind:'Button'}},actions:{}},nonce=crypto.randomUUID(),stamp=new Date(Date.now()-1000).toISOString(),scope={tenantId,environmentId,owner,flowId},intent={recordId:mode==='wrong-record'?flowId:recordId,flowId,contextAction:'Run_context',definitionSha256:hash(definition),nonce,dataMode:'synthetic',startedAt:stamp,check:{mode:'dry-run'}};
 const claim=await claimHeadlessRun(root,scope,intent);if(!['no-started-with-id','missing-id'].includes(mode))await claim.started({runId:'original',flowId,nonce});
 const pendingFile=path.join(root,(await fs.readdir(root)).find(f=>f.endsWith('.pending.json'))!);
 const calls:string[]=[],adapter:FlowAdapter={close:async()=>{},call:async(tool)=>{calls.push(tool);
  if(tool==='whoami')return{azIdentity:{tenantId,user:owner},tokenIdentity:{tenantId,username:owner},effectiveConnectivityIdentity:{tenantId,username:mode==='wrong-caller'?'another@example.test':owner},identityMismatch:false,connectivityIdentityMismatch:false};
  if(tool==='get_flow')return mode==='changed-definition'?{...definition,changed:true}:definition;
  if(tool==='get_run_details'){if(mode==='changed-hold')await fs.writeFile(pendingFile,JSON.stringify({...intent,nonce:crypto.randomUUID()}));return{id:`/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${mode==='foreign-run'?recordId:flowId}/runs/original`,name:'original',properties:{status:mode==='nonterminal'?'Running':mode==='cancelled'?'Cancelled':'Succeeded',startTime:stamp,endTime:mode==='future'?new Date(Date.now()+120000).toISOString():new Date().toISOString()}};}
  if(tool==='get_run_action_content')return{content:{correlationId:mode==='wrong-nonce'?crypto.randomUUID():nonce,mode:mode==='wrong-mode'?'dispatch':'dry-run',dataMode:mode==='wrong-data'?'mailbox':'synthetic',dispatch:false,privateText:'PRIVATE NEVER RETURNED'}};
  throw Error('Unexpected operation');}};
 const work=reconcileHeadlessVerificationRun({tenantId,environmentId,username:owner,environmentUrl:'https://approved.crm.dynamics.com'},recordId,flowId,mode==='journal-disagrees'?'another':mode==='no-started-with-id'?'original':undefined,adapter,new AbortController().signal,()=>{if(mode==='revoked')throw Error('Revoked');},root);
 if(mode==='revoked'){await expect(work).rejects.toThrow('Revoked');expect((await fs.stat(pendingFile)).isFile()).toBe(true);return;}
 const result=await work;
 const accepted=['verified','cancelled','no-started-with-id'].includes(mode);expect(result).toMatchObject({status:accepted?'observed':'unresolved',holdReleased:accepted,triggerInvoked:false,dispatchClaimPreserved:true,replayAuthorized:false,successAccepted:false});
 expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(calls.every(c=>['whoami','get_flow','get_run_details','get_run_action_content'].includes(c))).toBe(true);
 if(accepted){await expect(fs.stat(pendingFile)).rejects.toThrow();const archive=(await fs.readdir(root)).find(f=>f.endsWith('.terminal.json'))!;expect(await fs.readFile(path.join(root,archive),'utf8')).not.toContain('PRIVATE');await claimHeadlessRun(root,scope,{nonce:'new-reviewed-invocation'});}
 else expect((await fs.stat(pendingFile)).isFile()).toBe(true);
});
