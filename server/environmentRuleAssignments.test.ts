import {it,expect,vi,afterEach} from 'vitest';
import {environmentRuleAssignments} from './environmentRuleAssignments.ts';
const tenant='11111111-1111-4111-8111-111111111111',env='22222222-2222-4222-8222-222222222222',subject='33333333-3333-4333-8333-333333333333',binding={tenantId:tenant,environmentId:env,username:'owner@example.test'};
afterEach(()=>vi.restoreAllMocks());
function fixture(change:Record<string,unknown>={}){
 const claims={tid:tenant,oid:subject,aud:'https://api.powerplatform.com',exp:Date.now()/1000+3600,scp:'EnvironmentManagement.Environments.Read',upn:binding.username,...change};
 const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
 const run=vi.fn(async()=>JSON.stringify({tenant,accessToken:token})),fetch=vi.fn(async(_url:any,_init:any)=>new Response(JSON.stringify({value:[]}))),guard=vi.fn();
 return{token,run,fetch,guard,read:()=>environmentRuleAssignments(binding,'.',new AbortController().signal,guard,{run,fetch:fetch as typeof globalThis.fetch})};
}
it('uses only the fixed target route and existing delegated identity, retaining two stable metadata reads',async()=>{
 const f=fixture(),result=await f.read();expect(result).toMatchObject({status:'observed',completeResponse:true,assignmentCount:0,effectivePolicyVerified:false,operationEligibilityVerified:false,environmentId:env,subject});
 expect(f.run).toHaveBeenCalledExactlyOnceWith({executable:'az',args:['account','get-access-token','--resource','https://api.powerplatform.com','--tenant',tenant,'--output','json']},'.',{},expect.any(AbortSignal));
 expect(f.fetch).toHaveBeenCalledTimes(2);for(const[url,options]of f.fetch.mock.calls){expect(url).toBe('https://api.powerplatform.com/governance/ruleBasedPolicies/environments/'+env+'/assignments?includeRuleSetCounts=true&api-version=2024-10-01');expect(options).toMatchObject({method:'GET',redirect:'error',headers:{Authorization:'Bearer '+f.token}});}
 expect(JSON.stringify(result)).not.toContain(f.token);expect(f.guard).toHaveBeenCalled();
});
it.each([{tid:env},{aud:'https://foreign.example'},{upn:'foreign@example.test'},{preferred_username:'foreign@example.test'},{scp:''},{exp:0},{oid:'invalid'}])('refuses a mismatched, nondelegated or expired credential before API access: %j',async change=>{const f=fixture(change);expect(await f.read()).toMatchObject({status:'unavailable',completeResponse:false});expect(f.fetch).not.toHaveBeenCalled();});
it.each(['http','oversize','duplicate-json','next-link','foreign-tenant','foreign-environment','duplicate-row','changed'])('refuses incomplete or unstable %s metadata without exposing raw responses',async mode=>{
 const f=fixture(),row={policyId:'policy-one',resourceId:env,resourceType:'Environment',ruleSetCount:1,tenantId:tenant};let calls=0;
 f.fetch.mockImplementation(async()=>{calls++;if(mode==='http')return new Response('PRIVATE_ERROR',{status:403});if(mode==='oversize')return new Response('x'.repeat(65537));if(mode==='duplicate-json')return new Response('{"value":[],"value":[]}');
 const value=mode==='next-link'?{value:[],nextLink:'https://foreign.example'}:{value:mode==='duplicate-row'?[row,row]:mode==='foreign-tenant'?[{...row,tenantId:env}]:mode==='foreign-environment'?[{...row,resourceId:tenant}]:mode==='changed'&&calls===2?[row]:[]};return new Response(JSON.stringify(value));});
 const result=await f.read();expect(result).toMatchObject({status:'unavailable',effectivePolicyVerified:false});expect(JSON.stringify(result)).not.toMatch(/PRIVATE_ERROR|foreign.example|Bearer|signature/);
});
it('retains sorted stable assignment identities without inferring effective enforcement',async()=>{
 const f=fixture(),rows=['second','first'].map(policyId=>({policyId,resourceId:env,resourceType:'Environment',ruleSetCount:1,tenantId:tenant}));let calls=0;
 f.fetch.mockImplementation(async()=>new Response(JSON.stringify({value:++calls===1?rows:[...rows].reverse()})));
 expect(await f.read()).toMatchObject({status:'observed',assignmentCount:2,assignments:[{policyId:'first'},{policyId:'second'}],effectivePolicyVerified:false});
});
it('propagates scope revocation and cancellation instead of publishing unavailable evidence',async()=>{
 const f=fixture();f.guard.mockImplementation(()=>{throw Error('authority revoked');});await expect(f.read()).rejects.toThrow('authority revoked');expect(f.run).not.toHaveBeenCalled();
 const controller=new AbortController();controller.abort(Error('cancelled'));await expect(environmentRuleAssignments(binding,'.',controller.signal,()=>{},{run:f.run,fetch:f.fetch as typeof globalThis.fetch})).rejects.toThrow('cancelled');
});
it('accepts a provider environment GUID without RFC UUID version bits while retaining the exact target',async()=>{
 const f=fixture(),nativeEnv='a996e75a-0766-ed6f-9c68-f3d7918c3e4a';
 const result=await environmentRuleAssignments({...binding,environmentId:nativeEnv},'.',new AbortController().signal,()=>{},{run:f.run,fetch:f.fetch as typeof globalThis.fetch});
 expect(result).toMatchObject({status:'observed',environmentId:nativeEnv});expect(f.fetch.mock.calls[0][0]).toContain('/environments/'+nativeEnv+'/assignments');
});
