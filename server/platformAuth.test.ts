import { expect, it,vi } from 'vitest';
import { parsePacIdentity, verifyPlatformAuthentication, verifyFlowIdentity,verifyTypedActionAuthentication, type PlatformIdentity } from './platformAuth.ts';
const org = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const identity: PlatformIdentity = { tenantId: org, username: 'maker@example.com', environmentId: user };
const output = `Org ID: ${org}\nUser ID: ${user}\nOrg URL: https://target.crm4.dynamics.com/\nEnvironment ID: ${user}\nUser Email: maker@example.com`;
const who = { azIdentity: { tenantId: org, user: identity.username }, tokenIdentity: { tenantId: org, username: identity.username }, effectiveConnectivityIdentity: { tenantId: org, username: identity.username }, identityMismatch: false, connectivityIdentityMismatch: false };
it('accepts only explicit complete PAC identity observations', () => {
  expect(parsePacIdentity(output).organizationId).toBe(org);
  expect(() => parsePacIdentity('Connected as maker@example.com')).toThrow();
  expect(parsePacIdentity(output.replace(user, '48dd0213-f2f6-eb11-94ee-000d3a4bf7a5')).userId).toBe('48dd0213-f2f6-eb11-94ee-000d3a4bf7a5');
});
it('requires agreement across the effective flow identities', () => {
  expect(() => verifyFlowIdentity(who, identity)).not.toThrow();
  expect(() => verifyFlowIdentity({ ...who, tokenIdentity: { ...who.tokenIdentity, username: 'other@example.com' } }, identity)).toThrow('approved');
  expect(() => verifyFlowIdentity({ ...who, effectiveConnectivityIdentity: null }, identity)).toThrow();
});
it('creates a credential-free receipt only after both data planes and FlowAgent agree', async () => {
  const command = async (executable: string) => executable === 'pac' ? output : `Tenant: ${org}\nUser: maker@example.com\nEnvironment: https://target.crm4.dynamics.com/`;
  const request = async (_method:string,resource:string) => resource==='WhoAmI'?{ OrganizationId: org, UserId: user }:{Detail:{OrganizationId:org,EnvironmentId:user,TenantId:org,State:'Enabled'}};
  const result = await verifyPlatformAuthentication(command, request, 'https://target.crm4.dynamics.com', { organizationId: org, userId: user }, identity, async () => who);
  expect(result.providers).toEqual(['pac', 'dataverse', 'flowagent']);
  expect(JSON.stringify(result)).not.toContain('token');
  await expect(verifyPlatformAuthentication(command, request, 'https://wrong.crm4.dynamics.com', { organizationId: org, userId: user }, identity)).rejects.toThrow('PAC');
});

it.each(['Org ID','User ID','Org URL','Environment ID','User Email'])('rejects duplicate PAC fields: %s',label=>{
  const row=output.split('\n').find(line=>line.startsWith(`${label}:`))!;
  expect(()=>parsePacIdentity(`${output}\n${row.toLowerCase()}`)).toThrow('ambiguous');
});
it.each(['http://target.crm4.dynamics.com','https://target.crm4.dynamics.com/path','https://user:password@target.crm4.dynamics.com','https://target.crm4.dynamics.com/?private=value','https://target.crm4.dynamics.com/#fragment','https://target.crm4.dynamics.com:444'])('rejects unsafe PAC roots: %s',url=>{
  expect(()=>parsePacIdentity(output.replace('https://target.crm4.dynamics.com/',url))).toThrow();
});
it('rejects oversized PAC observations',()=>{expect(()=>parsePacIdentity(`${output}\n${'x'.repeat(65536)}`)).toThrow('bound');});
function fixture(){
  const command=vi.fn(async(executable:string):Promise<string>=>executable==='pac'?output:`Tenant: ${org}\nUser: maker@example.com\nEnvironment: https://target.crm4.dynamics.com/`);
  const request=vi.fn(async(_method:string,resource:string)=>resource==='WhoAmI'?{OrganizationId:org,UserId:user}:{Detail:{OrganizationId:org,EnvironmentId:user,TenantId:org,State:'Enabled'}});
  return {command,request,verify:(flowWho?:()=>Promise<unknown>)=>verifyPlatformAuthentication(command,request,'https://target.crm4.dynamics.com',{organizationId:org,userId:user},identity,flowWho)};
}
it('rejects Dataverse profile drift on the final observation',async()=>{
  const f=fixture();let profiles=0;f.command.mockImplementation(async executable=>executable==='pac'?output:`Tenant: ${org}\nUser: ${++profiles===1?'maker':'different'}@example.com\nEnvironment: https://target.crm4.dynamics.com/`);
  await expect(f.verify()).rejects.toThrow('Dataverse');expect(profiles).toBe(2);expect(f.command.mock.calls.filter(([executable])=>executable==='pac')).toHaveLength(1);
});
it('waits for admitted provider reads when another provider fails',async()=>{
  const f=fixture();let release!:(value:string)=>void;f.command.mockImplementation(async executable=>executable==='pac'?new Promise<string>(resolve=>{release=resolve;}):'Tenant: missing');
  let settled=false;const pending=f.verify().catch(()=>{settled=true;});await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);release(output);await pending;expect(settled).toBe(true);
});
it('denies FlowAgent mismatch and provider failure without a receipt',async()=>{
  const f=fixture();await expect(f.verify(async()=>({...who,identityMismatch:true}))).rejects.toThrow();
  await expect(f.verify(async()=>{throw new Error('Provider unavailable');})).rejects.toThrow('Provider unavailable');
});
it('validates approved identities before dispatch',async()=>{
  const f=fixture();await expect(verifyPlatformAuthentication(f.command,f.request,'https://target.crm4.dynamics.com',{organizationId:'invalid',userId:user},identity)).rejects.toThrow();expect(f.command).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
});

it.each(['workflow-state','connection-reference-check','record-share','schema-check'] as const)('authenticates Dataverse-only %s without unrelated providers',async type=>{
  const f=fixture(),flow=vi.fn(async()=>who);
  const receipt=await verifyTypedActionAuthentication({id:'test-action',type} as any,f.command,f.request,'https://target.crm4.dynamics.com',{organizationId:org,userId:user},identity,flow);
  expect(receipt).toMatchObject({scope:'typed-action-identity-observation',actionId:'test-action',providers:['dataverse'],dataverseObservationPasses:2});expect(f.command.mock.calls.every(([provider])=>provider==='dataverse')).toBe(true);expect(flow).not.toHaveBeenCalled();
});
it('requires matching FlowAgent identity for a typed cloud-flow action',async()=>{
  const f=fixture(),action={id:'flow',type:'cloud-flow-state' as const,component:'approval',state:'active' as const,forceManaged:false};
  const verify=(flowWho?:()=>Promise<unknown>)=>verifyTypedActionAuthentication(action,f.command,f.request,'https://target.crm4.dynamics.com',{organizationId:org,userId:user},identity,flowWho);
  await expect(verify()).rejects.toThrow('FlowAgent');expect(f.command).not.toHaveBeenCalled();
  await expect(verify(async()=>({...who,identityMismatch:true}))).rejects.toThrow();
  expect(await verify(async()=>who)).toMatchObject({providers:['dataverse','flowagent'],actionId:'flow'});expect(f.command.mock.calls.every(([provider])=>provider==='dataverse')).toBe(true);
});
it('retains PAC authentication for typed publication',async()=>{
  const f=fixture();const receipt=await verifyTypedActionAuthentication({id:'publish',type:'copilot-publish',component:'agent'},f.command,f.request,'https://target.crm4.dynamics.com',{organizationId:org,userId:user},identity);
  expect(receipt.providers).toContain('pac');expect(f.command.mock.calls.some(([provider])=>provider==='pac')).toBe(true);
});
