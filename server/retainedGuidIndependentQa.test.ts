import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {expect,it} from 'vitest';
import {seedRetainedCloud,target} from './testFixtures/retainedCloud.ts';
import {reconcileRetainedCloudHistory} from './retainedCloudRecovery.ts';
const legacy='5a89d846-73f1-eb11-94ee-000d3ab40fca';
it.each(['valid-legacy','malformed-identity','malformed-job'])('handles Dataverse GUID contract: %s',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retained-guid-independent-'));
 try{
  const binding={organizationId:legacy,userId:legacy};
  const f=await seedRetainedCloud(root,state=>{const release=state.releases[0];release.plan.verification.api.binding=binding;release.planHash=crypto.createHash('sha256').update(JSON.stringify({plan:release.plan,head:release.head,environmentUrl:release.environmentUrl})).digest('hex');state.runs[0].operations[0].platformJobId=legacy;});
  const supplied={...target,binding};const request={...f.input,targets:[supplied]};
  const observer={verifyTarget:async()=>({scope:'dataverse-identity-observation',checkedAt:new Date().toISOString(),environmentUrl:target.environmentUrl,...binding,...target.identity,...(mode==='malformed-identity'?{userId:'not-a-guid'}:{})}),importJob:async()=>({...f.row,importjobid:mode==='malformed-job'?'5a89d846-73f1-eb11-94ee-nothex000000':legacy})};
  if(mode==='valid-legacy')await expect(reconcileRetainedCloudHistory(root,request,observer,()=>{})).resolves.toMatchObject({remoteTerminalityVerified:true,releaseApproved:false});
  else await expect(reconcileRetainedCloudHistory(root,request,observer,()=>{})).rejects.toThrow();
  expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(f.lease);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
