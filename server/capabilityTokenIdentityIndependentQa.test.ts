import {afterEach,expect,it,vi} from 'vitest';
import {deliveryCommands} from './delivery.ts';
import {runCapabilityProbe} from './capabilityChecks.ts';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',username='maker@example.test';
const check={id:'actual-identity',category:'authentication' as const,remedy:'Verify the actual executing account',probe:{kind:'http' as const,url:'https://graph.microsoft.com/v1.0/me',azureCli:{tenantId:tenant,username},pointer:['ready'],equals:true}};
function credentials(fault?:string){const claims:any={tid:tenant,preferred_username:username};if(fault==='wrong-user')claims.preferred_username='other@example.test';if(fault==='wrong-claim-tenant')claims.tid=other;if(fault==='missing-user')delete claims.preferred_username;if(fault==='missing-tenant')delete claims.tid;if(fault==='conflicting-user'){claims.preferred_username='other@example.test';claims.upn=username;}return {tenant:fault==='wrong-native-tenant'?other:tenant,accessToken:fault==='malformed-token'?'invalid-token':`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`};}
it('uses one explicit token acquisition and binds the returned executing identity without querying default account metadata',async()=>{
 const native=vi.spyOn(deliveryCommands,'run').mockResolvedValue(JSON.stringify(credentials()));const fetch=vi.fn(async()=>({ok:true,text:async()=>'{"ready":true}'}));vi.stubGlobal('fetch',fetch);
 await expect(runCapabilityProbe(check,'.',new AbortController().signal)).resolves.toBeUndefined();expect(native).toHaveBeenCalledTimes(1);expect(native.mock.calls[0][0]).toEqual({executable:'az',args:['account','get-access-token','--resource','https://graph.microsoft.com/','--tenant',tenant,'--output','json']});expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(['wrong-user','wrong-claim-tenant','missing-user','missing-tenant','wrong-native-tenant','malformed-token','conflicting-user'])('refuses %s actual credential before HTTP',async fault=>{
 const native=vi.spyOn(deliveryCommands,'run').mockResolvedValue(JSON.stringify(credentials(fault))),fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(runCapabilityProbe(check,'.',new AbortController().signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();expect(native).toHaveBeenCalledTimes(1);
});
