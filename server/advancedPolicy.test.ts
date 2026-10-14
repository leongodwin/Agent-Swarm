import {expect,it,vi} from 'vitest';
import {advancedPolicyObservation,createAdvancedPolicyObserver} from './advancedPolicy.ts';
import crypto from 'node:crypto';
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',environmentId=`Default-${tenant}`;
const input={tenantId:tenant,caller:'tester@company.test',environmentId,checkout:'synthetic'};
const row={policyId:'policy-1',resourceId:environmentId,resourceType:'Environment',tenantId:tenant,ruleSetCount:1};
const detail={id:'policy-1',tenantId:tenant,name:'Observed connector rule',ruleSetCount:1,ruleSets:[{id:'ConnectorManagement',version:'1.0',inputs:{AllowedConnectorList:[]}}]};
function fixture(rows:unknown[]=[]){
  const account={tenantId:tenant,user:{name:input.caller,type:'user'}};
  const run=vi.fn(async(command:{executable:string;args:string[]}):Promise<string>=>JSON.stringify(command.args[0]==='account'?account:command.args.some(arg=>arg.includes('/assignments?'))?{value:rows}:detail));
  return {account,run,observe:createAdvancedPolicyObserver({run})};
}
it('observes an empty assignment inventory without certifying absence of enforcement',async()=>{
  const f=fixture(),result=await f.observe(input);expect(result).toMatchObject({status:'observed',complete:false,complianceVerified:false,assignments:[],policies:[],accountScope:'azure-cli-profile'});expect(result.observationSha256).toMatch(/^[a-f0-9]{64}$/);expect(result.reason).toContain('remain unverified');
  expect(f.run).toHaveBeenCalledTimes(4);for(const [command] of f.run.mock.calls){expect(command.executable).toBe('az');if(command.args[0]==='rest'){expect(command.args).toContain('get');expect(command.args).toContain('https://api.powerplatform.com');expect(command.args[command.args.indexOf('--url')+1]).toContain('includeRuleSetCounts=true&api-version=2024-10-01');}}
});
it('binds repeated assigned policy reads to the exact environment, tenant and policy ID',async()=>{
  const f=fixture([row]),result=await f.observe(input);expect(result).toMatchObject({status:'observed',assignments:[row],policies:[detail]});expect(f.run).toHaveBeenCalledTimes(6);
});
it.each([{...row,tenantId:other},{...row,resourceId:other},{...row,resourceType:'EnvironmentGroup'},{...row,policyId:'../other'},{...row,ruleSetCount:101},row])('denies unbound, unsafe or duplicate assignments: %#',async value=>{
  const f=fixture(value===row?[row,row]:[value]);expect((await f.observe(input)).status).toBe('unavailable');expect(f.run.mock.calls.filter(([command])=>command.args.some(arg=>/ruleBasedPolicies\/policy-1\?/.test(arg)))).toHaveLength(0);
});
it.each(['tenant','user','type'])('denies Azure CLI account %s drift before any API request',async field=>{
  const f=fixture();if(field==='tenant')f.account.tenantId=other;if(field==='user')f.account.user.name='other@company.test';if(field==='type')f.account.user.type='servicePrincipal';
  expect((await f.observe(input)).status).toBe('unavailable');expect(f.run).toHaveBeenCalledOnce();
});
it.each([{...detail,id:'other-policy'},{...detail,tenantId:other},{...detail,ruleSetCount:2},{...detail,ruleSets:[...detail.ruleSets,...detail.ruleSets],ruleSetCount:2}])('rejects unbound or ambiguous policy details: %#',async value=>{
  const f=fixture([row]),normal=f.run.getMockImplementation()!;f.run.mockImplementation(async command=>command.args.some(arg=>arg.includes('/policy-1?'))?JSON.stringify(value):normal(command));expect((await f.observe(input)).status).toBe('unavailable');
});
it.each([{value:[],nextLink:'https://untrusted.test'},{value:null},{value:[],error:{message:'private detail'}},{value:[],'@odata.nextLink':'https://api.powerplatform.com/other'}])('does not silently accept incomplete or paginated response %#',async response=>{
  const f=fixture(),normal=f.run.getMockImplementation()!;f.run.mockImplementation(async command=>command.args[0]==='rest'?JSON.stringify(response):normal(command));expect((await f.observe(input)).status).toBe('unavailable');expect(f.run).toHaveBeenCalledTimes(2);
});
it('discards partial evidence if assignments change between passes',async()=>{
  const f=fixture([row]),normal=f.run.getMockImplementation()!;let reads=0;
  f.run.mockImplementation(async command=>command.args.some(arg=>arg.includes('/assignments?'))&&++reads===2?JSON.stringify({value:[]}):normal(command));const result=await f.observe(input);expect(result.status).toBe('unavailable');expect(result.assignments).toEqual([]);expect(result.policies).toEqual([]);
});
it('discards an observation after final account drift',async()=>{
  const f=fixture(),normal=f.run.getMockImplementation()!;let reads=0;
  f.run.mockImplementation(async command=>command.args[0]==='account'&&++reads===2?JSON.stringify({...f.account,tenantId:other}):normal(command));expect((await f.observe(input)).status).toBe('unavailable');
});
it('discards partial evidence if a policy changes while its assignment stays unchanged',async()=>{
  const f=fixture([row]),normal=f.run.getMockImplementation()!;let reads=0;
  f.run.mockImplementation(async command=>command.args.some(arg=>arg.includes('/policy-1?'))&&++reads===2?JSON.stringify({...detail,name:'Changed policy'}):normal(command));const result=await f.observe(input);expect(result.status).toBe('unavailable');expect(result.policies).toEqual([]);
});
it('bounds accumulated policy responses across individually bounded reads',async()=>{
  const rows=Array.from({length:6},(_,index)=>({...row,policyId:`policy-${index}`})),f=fixture(rows),normal=f.run.getMockImplementation()!;
  f.run.mockImplementation(async command=>{const url=command.args[command.args.indexOf('--url')+1];const id=url?.match(/ruleBasedPolicies\/(policy-\d+)\?/)?.[1];return id?JSON.stringify({...detail,id,additional:'x'.repeat(1500000)}):normal(command);});
  const result=await f.observe(input);expect(result.status).toBe('unavailable');expect(result.assignments).toEqual([]);expect(result.policies).toEqual([]);
});
it('waits for the issued native read after cancellation and denies its late response',async()=>{
  const f=fixture(),controller=new AbortController();let release!:(value:string)=>void;f.run.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));let settled=false;
  const pending=f.observe({...input,signal:controller.signal}).then(value=>{settled=true;return value;});await Promise.resolve();controller.abort();await Promise.resolve();expect(settled).toBe(false);release(JSON.stringify(f.account));expect((await pending).status).toBe('unavailable');expect(f.run).toHaveBeenCalledOnce();
});
it('bounds provider output and conceals native diagnostics',async()=>{
  const f=fixture();f.run.mockResolvedValue('x'.repeat(2*1024*1024+1));expect((await f.observe(input)).status).toBe('unavailable');
  f.run.mockRejectedValue(new Error('private bearer token'));expect(JSON.stringify(await f.observe(input))).not.toContain('private');
});
it('rejects malformed approved input before dispatch',async()=>{const f=fixture();await expect(f.observe({...input,environmentId:'../unsafe'})).rejects.toThrow();expect(f.run).not.toHaveBeenCalled();});
it.each(['digest','assignment-tenant','policy-tenant','environment','policy-id','count','duplicate-policy','duplicate-rule','unavailable-facts'])('revalidates policy receipt facts at the consumer boundary: %s',async fault=>{
  const value=await fixture([row]).observe(input);
  if(fault==='assignment-tenant')value.assignments[0].tenantId=other;if(fault==='policy-tenant')value.policies[0].tenantId=other;if(fault==='environment')value.assignments[0].resourceId=other;
  if(fault==='policy-id')value.policies[0].id='unbound';if(fault==='count')value.policies[0].ruleSetCount=2;if(fault==='duplicate-policy')value.policies.push(value.policies[0]);if(fault==='duplicate-rule'){value.policies[0].ruleSets.push(value.policies[0].ruleSets[0]);value.policies[0].ruleSetCount=2;value.assignments[0].ruleSetCount=2;}
  value.observationSha256=crypto.createHash('sha256').update(JSON.stringify({assignments:value.assignments,policies:value.policies})).digest('hex');
  if(fault==='digest')value.observationSha256='a'.repeat(64);if(fault==='unavailable-facts')value.status='unavailable';
  expect(advancedPolicyObservation.safeParse(value).success).toBe(false);
});
