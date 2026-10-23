import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {connectorProbeRuntime} from './connectorProbeRuntime.ts';
import {connectorProbeControlIds} from './connectorProbeReview.ts';
import {connectorProbeFixturePlan,connectorProbeFixtureRecord} from './testFixtures/connectorProbe.ts';
import {taskScopeHash} from './taskScope.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('as-probe-runtime-'))throw Error('Unexpected test root');await fs.rm(root,{recursive:true,force:true});}});
async function fixture(){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'as-probe-runtime-'));roots.push(home);const dir=path.join(home,'planning','evidence');await fs.mkdir(dir,{recursive:true});
 const plan=connectorProbeFixturePlan(),record=connectorProbeFixtureRecord(plan);plan.taskHash=taskScopeHash(record,plan.issue)!;const controls=[];
 for(const id of connectorProbeControlIds){const reference=path.join(dir,id+'.txt'),text='Synthetic control only: '+id;await fs.writeFile(reference,text);controls.push({id,evidence:[{reference,sha256:crypto.createHash('sha256').update(text).digest('hex'),observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}]});}
 const contract={schemaVersion:1,plan,controls},file=path.join(home,'connector-probe-contract.json');await fs.writeFile(file,JSON.stringify(contract));const guard=vi.fn();let fingerprint='current-config';const runtime=connectorProbeRuntime({home,configurationRoot:home,record:()=>record,configurationFingerprint:()=>fingerprint,guard});
 return{home,plan,record,file,contract,guard,runtime,change:()=>{fingerprint='changed-config';}};
}
it('composes the exact installed sources and current config, without an executor',async()=>{const f=await fixture(),v=await f.runtime.inspect();expect(v.proposal.implementationSources.map(s=>s.file)).toContain('server/connectorProbeRuntime.ts');expect(v.proposal.plan.implementationSha256).not.toBe(f.plan.implementationSha256);expect(v.proposal.plan.configurationSha256).not.toBe(f.plan.configurationSha256);expect(v.review).toBeNull();expect(f.runtime).not.toHaveProperty('execute');expect(v.proposal.businessAuthorityGranted).toBe(false);});
it('routes bounded source/control reads without generic file access',async()=>{const f=await fixture(),v=await f.runtime.inspect(),s=v.proposal.implementationSources[0];const p:any=await f.runtime.handle({action:'read',kind:'source',key:s.file,expectedSha256:s.sha256},{id:f.plan.qaOwner,role:'qa'});expect(p.text).toContain('node:crypto');expect(p.text.length).toBeLessThanOrEqual(6000);await expect(f.runtime.handle({action:'read',kind:'source',key:'../secret',expectedSha256:s.sha256},{id:f.plan.qaOwner,role:'qa'})).rejects.toThrow();});
it('invalidates the exact proposal when capability config changes',async()=>{const f=await fixture(),before=await f.runtime.inspect();f.change();expect((await f.runtime.inspect()).proposalSha256).not.toBe(before.proposalSha256);});
it('keeps owner and manager unable to persist approval',async()=>{const f=await fixture(),p=await f.runtime.inspect(),notes='Synthetic review of the exact fixed metadata probe, without any business approval or native runtime evidence.',input={action:'review',proposalSha256:p.proposalSha256,decision:'approved',notes,controls:connectorProbeControlIds.map(id=>({id,decision:'approved',notes}))};await expect(f.runtime.handle(input,{id:f.plan.owner,role:'dev'})).rejects.toThrow('Only assigned independent QA');await f.runtime.handle(input,{id:f.plan.qaOwner,role:'qa'});expect((await f.runtime.inspect()).review?.decision).toBe('approved');});
it.each(['code','definition','extra'])('refuses configuration-supplied %s',async key=>{const f=await fixture();await fs.writeFile(f.file,JSON.stringify({...f.contract,[key]:'untrusted'}));await expect(f.runtime.inspect()).rejects.toThrow();});
it('refuses missing configuration and revoked guards',async()=>{const f=await fixture();f.guard.mockImplementation(()=>{throw Error('Revoked');});await expect(f.runtime.inspect()).rejects.toThrow('Revoked');f.guard.mockReset();await fs.unlink(f.file);await expect(f.runtime.inspect()).rejects.toThrow();});
