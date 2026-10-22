import crypto from 'node:crypto';
import {expect,it} from 'vitest';
import {verifyControlledFailure} from './controlledFailure.ts';
import type {FlowAdapter} from './flowAdapter.ts';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(mode='valid'){
 const startTime='2026-10-19T01:00:00Z',endTime='2026-10-19T01:00:10Z',runId='actual-run',run={name:runId,properties:{startTime,endTime,status:'Succeeded'}},expected={runId,startTime,endTime,providerRunSha256:hash(run),controlledAction:'ControlledFailure',persistenceAction:'PersistFailure'};
 let actionsRead=0,runRead=0;const calls:string[]=[],actions=[{name:'ControlledFailure',status:'Failed',startTime,endTime:'2026-10-19T01:00:02Z'},{name:'PersistFailure',status:'Succeeded',startTime:'2026-10-19T01:00:03Z',endTime},{name:'UnusedBranch',status:'Skipped'}];
 const adapter:FlowAdapter={close:async()=>{},call:async(tool,args)=>{calls.push(tool);expect(args).toEqual({env:'environment',flow:'flow',run:runId});if(tool==='get_run_details'){runRead++;return mode==='wrong-run'||mode==='run-drift'&&runRead>1?{...run,name:'other-run'}:run;}if(tool==='get_run_actions'){actionsRead++;return mode==='action-drift'&&actionsRead>1?actions.slice(1):actions;}throw Error('Unexpected operation');}};
 return{adapter,expected,calls};
}
it('binds exact native Failed action, later Succeeded persistence and stable terminal run with read-only calls',async()=>{const f=fixture(),proof=await verifyControlledFailure(f.adapter,'environment','flow',f.expected,async()=>{});expect(proof.controlled.status).toBe('Failed');expect(proof.persistence.status).toBe('Succeeded');expect(f.calls).toEqual(['get_run_details','get_run_actions','get_run_actions','get_run_details']);expect(JSON.stringify(proof)).not.toContain('UnusedBranch');});
it.each(['wrong-run','run-drift','action-drift'])('rejects %s evidence',async mode=>{const f=fixture(mode);await expect(verifyControlledFailure(f.adapter,'environment','flow',f.expected,async()=>{})).rejects.toThrow();});
