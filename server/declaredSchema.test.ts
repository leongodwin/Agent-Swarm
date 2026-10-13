import {expect,it,vi} from 'vitest';
import {createDeclaredSchemaObserver} from './declaredSchema.ts';
import type {LifecycleRequest} from './lifecycleGovernance.ts';
const guid='11111111-1111-4111-8111-111111111111',metadata='22222222-2222-4222-8222-222222222222',environment='https://synthetic.crm4.dynamics.com';
const manifest={schemaVersion:1,solutionUniqueName:'Expenses',solutionVersion:'1.0.0.0',solutionZip:'release.zip',hasUi:false,recovery:{runbook:'recovery.md',rehearsalReport:'drill.json'},documentation:['one.md','two.md','three.md'],build:[{executable:'node',args:['build.js']}],test:[{executable:'node',args:['test.js']}],verify:[{executable:'node',args:['verify.js']}],targetBinding:{organizationId:guid,userId:guid},platformIdentity:{tenantId:guid,username:'tester@company.test',environmentId:guid},targetComponents:[{key:'table',kind:'dataverse-table',logicalName:'exp_report'}],postDeployActions:[{id:'schema',type:'schema-check',component:'table',columns:[{name:'exp_title',type:'String',required:'None',constraints:{maxLength:100}}]}]};
const input:LifecycleRequest={phase:'verify',sourceCommit:'a'.repeat(40),environmentUrl:environment,releaseId:'release-1',checkout:'synthetic',manifest};
function fixture(options:{length?:number;drift?:boolean;truncated?:boolean}={}){
  let identities=0;
  const attribute={LogicalName:'exp_title',MetadataId:metadata,AttributeType:'String',RequiredLevel:{Value:'None'},MaxLength:options.length??100};
  const run=vi.fn(async(command:{executable:string;args:string[]})=>{
    if(command.executable==='pac')return `Org ID: ${guid}\nUser ID: ${guid}\nOrg URL: ${environment}\nEnvironment ID: ${guid}\nUser Email: ${options.drift&&++identities>1?'other@company.test':'tester@company.test'}`;
    if(command.args[0]==='auth')return `Tenant: ${guid}\nUser: tester@company.test\nEnvironment: ${environment}`;
    const resource=command.args[command.args.indexOf('--path')+1];
    if(resource.endsWith('WhoAmI'))return JSON.stringify({OrganizationId:guid,UserId:guid});
    if(resource.includes('/Attributes('))return JSON.stringify(attribute);
    const next=options.truncated?{'@odata.nextLink':'https://unapproved.test/metadata'}:{};
    if(resource.includes('/Attributes?'))return JSON.stringify({value:[attribute],...next});
    return JSON.stringify({value:[{LogicalName:'exp_report',Attributes:[attribute]}],...next});
  });
  return {run,observe:createDeclaredSchemaObserver({run})};
}
it('reads freshly at all six stages, pins identity before/after and never claims complete schema coverage',async()=>{
  const {run,observe}=fixture();
  for(const phase of ['build','test','import','post-deploy','verify','health'] as const){
    const result=await observe({...input,phase});expect(result).toMatchObject({status:'observed',complete:false,scope:'declared-target-schema',phase,tables:['exp_report']});expect(result.observations).toHaveLength(2);expect(result.reason).toContain('remain unverified');
  }
  expect(run.mock.calls.filter(([command])=>command.executable==='pac')).toHaveLength(12);
  for(const [command] of run.mock.calls.filter(([command])=>command.args[0]==='api')){
    expect(command.args[command.args.indexOf('--environment')+1]).toBe(environment);expect(command.args[command.args.indexOf('--method')+1]).toBe('GET');
  }
});
it.each(['https://unapproved.test','https://synthetic.crm4.dynamics.com/path','https://synthetic.crm4.dynamics.com/?token=private'])('refuses unapproved metadata destinations before any command: %s',async environmentUrl=>{
  const {run,observe}=fixture();expect((await observe({...input,environmentUrl})).status).toBe('unavailable');expect(run).not.toHaveBeenCalled();
});
it.each(['no-identity','no-binding','no-contract','no-tables','duplicate-table'])('denies incomplete or ambiguous contracts: %s',async mode=>{
  const modified=structuredClone(manifest) as any;
  if(mode==='no-identity')delete modified.platformIdentity;if(mode==='no-binding')delete modified.targetBinding;if(mode==='no-contract')modified.postDeployActions=[];if(mode==='no-tables'){modified.targetComponents=[];modified.postDeployActions=[];}
  if(mode==='duplicate-table'){modified.targetComponents.push({...modified.targetComponents[0],key:'duplicate'});modified.postDeployActions.push({...modified.postDeployActions[0],component:'duplicate',id:'duplicate'});}
  const {run,observe}=fixture();expect((await observe({...input,manifest:modified})).status).toBe('unavailable');expect(run).not.toHaveBeenCalled();
});
it('allows declared additive expansion before import and rejects different final constraints',async()=>{
  const {observe}=fixture({length:80});expect((await observe({...input,phase:'import'})).status).toBe('observed');const result=await observe(input);expect(result.status).toBe('unavailable');expect(result.observations).toEqual([]);
});
it.each([{drift:true},{truncated:true}])('does not publish observations after identity drift or truncated metadata: %#',async options=>{
  const {observe}=fixture(options);const result=await observe(input);expect(result.status).toBe('unavailable');expect(result.observations).toEqual([]);
});
it('does not dispatch after cancellation or leak raw provider errors',async()=>{
  const controller=new AbortController();controller.abort();const {run,observe}=fixture();expect((await observe({...input,signal:controller.signal})).status).toBe('unavailable');expect(run).not.toHaveBeenCalled();
  run.mockRejectedValueOnce(new Error('private token'));const result=await observe(input);expect(JSON.stringify(result)).not.toContain('private token');expect(result.status).toBe('unavailable');
});

it('revokes a pending native observation on cancellation before metadata can be read',async()=>{
  const controller=new AbortController();const {run,observe}=fixture();let resolve!:(text:string)=>void;
  run.mockImplementationOnce(()=>new Promise<string>(yes=>{resolve=yes;}));
  const pending=observe({...input,signal:controller.signal});await Promise.resolve();controller.abort();resolve('private cancelled output');
  const result=await pending;expect(result.status).toBe('unavailable');expect(result.observations).toEqual([]);expect(run).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('private cancelled output');
});
it('bounds total schema response bytes before parsing and publishing evidence',async()=>{
  const {run,observe}=fixture();const normal=run.getMockImplementation()!;
  run.mockImplementation(async command=>command.args.includes('api')?JSON.stringify({OrganizationId:guid,UserId:guid,padding:'x'.repeat(8*1024*1024)}):normal(command));
  const result=await observe(input);expect(result.status).toBe('unavailable');expect(result.observations).toEqual([]);
});
