import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it,expect,vi,afterEach} from 'vitest';
import {functionalFixture} from './testFixtures/functionalShowcase.ts';
import {functionalRejectedCheckSchema,functionalTransportCheck} from '../shared/functionalShowcase.ts';
import {verifyFunctionalRejection,functionalRejectionEvidence} from './functionalRejection.ts';
import type {NativeDeniedFactory} from './nativeDeniedAccess.ts';
const roots:string[]=[];afterEach(async()=>{vi.useRealTimers();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
async function fixture(status=403){const root=await fs.mkdtemp(path.join(os.tmpdir(),'functional-rejection-'));roots.push(root);const f=functionalFixture(),evidence=path.join(root,'evidence'),claimRoot=path.join(root,'claims'),attempt=vi.fn(async(correlationKey:string)=>({status,targetSha256:f.targetSha256,subject:f.subject,correlationKey})),close=vi.fn(async()=>{}),observe=vi.fn(async(correlationKey:string)=>({targetSha256:f.targetSha256,correlationKey,completeWrites:false,completeDispatches:false,reason:'Bounded provider observation only'}));
 const factory:NativeDeniedFactory=async()=>({capabilities:async()=>({contract:'native-denied-create-v1',authenticatedIdentity:true,deniedCreate:true,exactCorrelation:true,completeWrites:false,completeDispatches:false}),identity:async role=>({authenticated:true,audience:'native-target',tenantId:f.tenantId,subject:f.subject,username:'leon@example.test',targetSha256:f.targetSha256,clientId:role==='denied'?f.config.rejection.authorizationBoundary.deniedClientId:f.config.rejection.authorizationBoundary.observerClientId}),attempt,observe,close});
 const run=(connect=factory,signal=new AbortController().signal)=>verifyFunctionalRejection(f.config.rejection,f.context,evidence,claimRoot,f.leaseSha256,connect,signal,async()=>{},async ms=>{vi.setSystemTime(Date.now()+ms);});return{...f,root,evidence,claimRoot,attempt,close,observe,factory,run};}
it('proves one real adapter403 and seals bounded observations without claiming complete history',async()=>{
 vi.useFakeTimers({toFake:['Date']});const f=await fixture(),file=await f.run();await fs.writeFile(path.join(f.evidence,'functional-rejection-index.json'),JSON.stringify({schemaVersion:1,file}));const read=(name:string)=>fs.readFile(path.join(f.evidence,name));const files=await functionalRejectionEvidence(f.config.rejection,f.context,read,f.claimRoot,f.leaseSha256);expect(files).toContain(file);expect(f.attempt).toHaveBeenCalledOnce();expect(f.observe).toHaveBeenCalledTimes(2);expect(f.close).toHaveBeenCalledOnce();const result=JSON.parse(await read(file).then(v=>v.toString()));expect(result).toMatchObject({completeHistoricalAbsenceVerified:false,productionAcceptance:false,retryAuthorized:false});
 await expect(f.run()).rejects.toThrow();expect(f.attempt).toHaveBeenCalledOnce();
});
it('declares only pre/post observations and refuses unsupported polling promises',()=>{
 const check=functionalFixture().config.rejection;expect(functionalRejectedCheckSchema.parse(check).contract).toMatchObject({observationMode:'pre-and-post'});
 for(const contract of [{...check.contract,pollIntervalMs:100},{...check.contract,observationMode:'periodic'},{...check.contract,observationMode:undefined}])expect(functionalRejectedCheckSchema.safeParse({...check,contract}).success).toBe(false);
 const transport=functionalTransportCheck(check);expect(transport.contract.pollIntervalMs).toBe(1000);expect(transport.contract.adapter).toBe('native-denied-create-v1');expect('observationMode'in transport.contract).toBe(false);
});
it.each([200,401,429,500])('refuses status%s and retains the immutable claim so it cannot replay',async status=>{
 vi.useFakeTimers({toFake:['Date']});const f=await fixture(status);await expect(f.run()).rejects.toThrow();await expect(f.run()).rejects.toThrow();expect(f.attempt).toHaveBeenCalledOnce();expect((await fs.readdir(f.claimRoot)).some(n=>n.startsWith('native-denied-claim-'))).toBe(true);
});
it('rejects wrong client identity before dispatch and rejects altered evidence bindings',async()=>{
 vi.useFakeTimers({toFake:['Date']});const f=await fixture(),wrong:NativeDeniedFactory=async(...args)=>{const a=await f.factory(...args);return{...a,identity:async role=>({...await a.identity(role) as object,clientId:f.flowId})};};await expect(f.run(wrong)).rejects.toThrow('identity');expect(f.attempt).not.toHaveBeenCalled();const file=await f.run();await fs.writeFile(path.join(f.evidence,'functional-rejection-index.json'),JSON.stringify({schemaVersion:1,file}));await expect(functionalRejectionEvidence(f.config.rejection,{...f.context,planHash:'f'.repeat(64)},n=>fs.readFile(path.join(f.evidence,n)),f.claimRoot,f.leaseSha256)).rejects.toThrow('binding');
});
it('cannot produce a candidate when adapter cleanup fails',async()=>{
 vi.useFakeTimers({toFake:['Date']});const f=await fixture(),bad:NativeDeniedFactory=async(...args)=>({...await f.factory(...args),close:async()=>{throw Error('cleanup unknown');}});await expect(f.run(bad)).rejects.toThrow('cleanup');expect(f.attempt).toHaveBeenCalledOnce();for(const n of await fs.readdir(f.evidence)){const value=JSON.parse(await fs.readFile(path.join(f.evidence,n),'utf8'));expect(value.kind).not.toBe('functional-rejected-request');}await expect(f.run()).rejects.toThrow();expect(f.attempt).toHaveBeenCalledOnce();
});
it('retains an interrupted dispatched claim and never turns it into a candidate or automatic replay',async()=>{
 vi.useFakeTimers({toFake:['Date']});const f=await fixture(),controller=new AbortController(),interrupted:NativeDeniedFactory=async(...args)=>{const a=await f.factory(...args);return{...a,attempt:async key=>{const response=await a.attempt(key);controller.abort(Error('operator interruption'));return response;}};};await expect(f.run(interrupted,controller.signal)).rejects.toThrow();expect(f.close).toHaveBeenCalledOnce();await expect(f.run()).rejects.toThrow();expect(f.attempt).toHaveBeenCalledOnce();expect((await fs.readdir(f.claimRoot)).some(n=>n.startsWith('native-denied-claim-'))).toBe(true);
});
