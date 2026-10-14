import {expect,it,vi} from 'vitest';
import {currentOrganizationResource,verifyDataverseIdentity} from './dataverseIdentity.ts';
const guid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const target='https://synthetic.crm4.dynamics.com',binding={organizationId:guid,userId:guid},identity={tenantId:guid,environmentId:`Default-${guid}`,username:'tester@company.test'};
const profile=`Tenant: ${guid}\nUser: tester@company.test\nEnvironment: ${target}/`;
function fixture(){
  const detail={OrganizationId:guid,EnvironmentId:identity.environmentId,TenantId:guid,State:'Enabled'};
  const command=vi.fn(async()=>profile);
  const request=vi.fn(async(_method:string,resource:string)=>resource==='WhoAmI'?{OrganizationId:guid,UserId:guid}:{Detail:detail});
  return {detail,command,request,verify:()=>verifyDataverseIdentity(command,request,target,binding,identity)};
}
it('checks the actual provider data-plane identity and returns a provider-scoped receipt',async()=>{
  const f=fixture();expect(await f.verify()).toMatchObject({scope:'dataverse-identity-observation',providers:['dataverse'],environmentUrl:target,...binding,...identity});
  expect(f.command).toHaveBeenCalledExactlyOnceWith('dataverse',['auth','who']);
  expect(f.request.mock.calls).toEqual([['GET','WhoAmI'],['GET',currentOrganizationResource]]);
});
it.each(['OrganizationId','EnvironmentId','TenantId','State'])('rejects organization %s drift',async key=>{
  const f=fixture();(f.detail as any)[key]=key==='State'?'Disabled':other;await expect(f.verify()).rejects.toThrow();
});
it('rejects actual executing user drift',async()=>{
  const f=fixture();f.request.mockImplementation(async()=>({OrganizationId:guid,UserId:other}) as any);await expect(f.verify()).rejects.toThrow();
});
it.each([
  profile.replace(guid,other),profile.replace('tester@company.test','other@company.test'),profile.replace(target,'https://other.crm4.dynamics.com'),
  `${profile}\nTenant: ${guid}`,`${profile}\nuSeR: other@company.test`,`${profile}\nEnvironment: ${target}`,
  profile.replace('Tenant:', 'Missing:'),profile.replace(target,`${target}/path`),profile.replace(target,`${target}/?secret=value`),
  profile.replace(target,'http://synthetic.crm4.dynamics.com'),profile.replace(target,'https://user:password@synthetic.crm4.dynamics.com'),
  profile.replace(target,'https://synthetic.crm4.dynamics.com:444'),profile.replace(target,`${target}/#fragment`),
  `${profile}\n${'x'.repeat(65536)}`,profile.replace('User: tester@company.test','User: '),
])('rejects ambiguous, mismatched or unsafe profile %#',async output=>{
  const f=fixture();f.command.mockResolvedValue(output);await expect(f.verify()).rejects.toThrow();
});
it('settles all admitted reads before surfacing a failure',async()=>{
  const f=fixture();let release!:()=>void;f.command.mockImplementation(()=>new Promise<string>(resolve=>{release=()=>resolve(profile);}));
  f.detail.TenantId=other;let settled=false;const pending=f.verify().catch(()=>{settled=true;});
  await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);expect(f.request).toHaveBeenCalledTimes(2);release();await pending;expect(settled).toBe(true);
});
it('validates approved inputs before issuing any read',async()=>{
  const f=fixture();await expect(verifyDataverseIdentity(f.command,f.request,`${target}/path`,binding,identity)).rejects.toThrow();expect(f.command).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
});
