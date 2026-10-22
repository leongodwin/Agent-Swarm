import {expect,it,vi} from 'vitest';
import {verifyDataverseIdentity,currentOrganizationResource} from './dataverseIdentity.ts';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const target='https://approved.crm4.dynamics.com',binding={organizationId:id,userId:id},identity={tenantId:id,environmentId:id,username:'tester@example.test'};
function fixture(){
 const user:any={systemuserid:id,domainname:identity.username,isdisabled:false,applicationid:null};
 const who:any={OrganizationId:id,UserId:id};
 const command=vi.fn(async()=>`Tenant: ${id}\nUser: ${identity.username}\nEnvironment: https://different.crm4.dynamics.com`);
 const request=vi.fn(async(method:string,resource:string)=>{expect(method).toBe('GET');if(resource==='WhoAmI')return who;if(resource===currentOrganizationResource)return {Detail:{OrganizationId:id,EnvironmentId:id,TenantId:id,State:'Enabled'}};return user;});
 return {user,who,command,request,verify:()=>verifyDataverseIdentity(command,request,target,binding,identity)};
}
it('accepts a genuine explicit-target account despite another default without selecting a profile',async()=>{const f=fixture();await expect(f.verify()).resolves.toMatchObject({environmentUrl:target,userId:id});expect(f.command.mock.calls).toEqual([['dataverse',['auth','who']]]);expect(f.request.mock.calls).toContainEqual(['GET',`systemusers(${id})?$select=systemuserid,domainname,isdisabled,applicationid`]);});
it.each(['systemuserid','domainname','isdisabled','applicationid','missing'])('refuses explicit-target account %s drift',async field=>{const f=fixture();if(field==='missing')delete f.user.applicationid;else f.user[field]=field==='isdisabled'?true:other;await expect(f.verify()).rejects.toThrow();});
it('cannot use an approved account record to conceal a different executing user',async()=>{const f=fixture();f.who.UserId=other;await expect(f.verify()).rejects.toThrow();});
it('refuses an unreadable target user instead of falling back to the configured profile',async()=>{const f=fixture(),original=f.request.getMockImplementation()!;f.request.mockImplementation(async(method,resource)=>{if(resource.startsWith('systemusers('))throw new Error('403 Forbidden');return original(method,resource);});await expect(f.verify()).rejects.toThrow('403');});
