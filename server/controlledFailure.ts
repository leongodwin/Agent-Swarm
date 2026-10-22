import crypto from 'node:crypto';
import {z} from 'zod';
import type {FlowAdapter} from './flowAdapter.ts';
const action=z.object({name:z.string(),status:z.string(),startTime:z.iso.datetime({offset:true}),endTime:z.iso.datetime({offset:true})});
export const controlledFailureProofSchema=z.strictObject({runId:z.string(),controlled:action,persistence:action,providerActionsSha256:z.string().regex(/^[a-f0-9]{64}$/),providerRunSha256:z.string().regex(/^[a-f0-9]{64}$/)});
const hash=(raw:unknown)=>{const text=JSON.stringify(raw);if(!text||Buffer.byteLength(text)>256000)throw Error('Controlled failure provider evidence oversized');return crypto.createHash('sha256').update(text).digest('hex');};
export function assertControlledFailure(raw:unknown,expected:{runId:string;startTime:string;endTime:string;providerRunSha256:string;controlledAction:string;persistenceAction:string}){
 const p=controlledFailureProofSchema.parse(raw),f=p.controlled,s=p.persistence;
 if(p.runId!==expected.runId||p.providerRunSha256!==expected.providerRunSha256||f.name!==expected.controlledAction||s.name!==expected.persistenceAction||f.name===s.name||f.status!=='Failed'||s.status!=='Succeeded'||Date.parse(f.startTime)<Date.parse(expected.startTime)||Date.parse(f.endTime)<Date.parse(f.startTime)||Date.parse(s.startTime)<Date.parse(f.endTime)||Date.parse(s.endTime)<Date.parse(s.startTime)||Date.parse(s.endTime)>Date.parse(expected.endTime))throw Error('Actual controlled failure and later persistence are not established');
 return p;
}
/** Native get_run_actions returns summarized name/status/startTime/endTime rows
 * (verified against bundled FlowAgent3.2.1). Never follows payload/SAS links. */
export async function verifyControlledFailure(adapter:FlowAdapter,environmentId:string,flowId:string,expected:Parameters<typeof assertControlledFailure>[1],guard:()=>Promise<void>){
 const call=async(tool:string)=>{await guard();const raw=await adapter.call(tool,{env:environmentId,flow:flowId,run:expected.runId});await guard();return raw;};
 const before=await call('get_run_details');if(hash(before)!==expected.providerRunSha256)throw Error('Controlled failure exact native run changed');
 const raw=await call('get_run_actions'),digest=hash(raw),rows=z.array(z.object({name:z.string()}).passthrough()).max(1000).parse(raw);
 const selected=(name:string)=>{const values=rows.filter(a=>a.name===name);if(values.length!==1)throw Error('Controlled failure action missing or ambiguous');return action.parse(values[0]);};
 const proof=assertControlledFailure({runId:expected.runId,controlled:selected(expected.controlledAction),persistence:selected(expected.persistenceAction),providerActionsSha256:digest,providerRunSha256:expected.providerRunSha256},expected);
 if(hash(await call('get_run_actions'))!==digest||hash(await call('get_run_details'))!==expected.providerRunSha256)throw Error('Controlled failure action/run changed during observation');
 return proof;
}
