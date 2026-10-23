import {describe,expect,it,vi} from 'vitest';
import {observeHeadlessSource} from './headlessSourceObservation.ts';
import {sourceDigest,validateSourceCapsule,validateSourceRepetitions,ownerInboxUri,assertSourceCapsuleDefinition,sourceInitialUriTemplate,sourcePageJsonSchema,sourceUriGuardExpression,sourceMailboxGuardExpression,sourceInitialUriForWindow,validateSourceContinuation} from './headlessSourceContract.ts';

const nonce='0d40fa87-0d5e-4340-94ba-00b41461ad1b';
const run={startedAt:'2026-10-23T11:00:00Z',endedAt:'2026-10-23T11:02:00Z'};
const expected={...run,dataMode:'synthetic' as const,nonce};
function message(id='private-id'){return{id,receivedDateTime:'2026-10-20T12:00:00Z',sender:{emailAddress:{address:'private@example.com'}},subject:'Private subject',isRead:false,hasAttachments:false,body:{contentType:'text',content:'Private source body'}};}
function fixture():any{return{schemaVersion:1,dataMode:'synthetic',correlationId:nonce,window:{startUtc:'2026-10-09T11:00:00Z',endUtc:run.startedAt},pages:[{statusCode:200,headers:{},body:{value:[message()]}}]};}
const rejection=(raw:unknown)=>expect(()=>validateSourceCapsule(raw,expected)).toThrow(/^SOURCE_CAPSULE_VERIFICATION_FAILED$/);
describe('source capsule fail-closed evidence validation',()=>{
 it('retains actual JSON values and hashes without leaking them into counts',()=>{const f=fixture(),result=validateSourceCapsule(f,expected);expect(result.capsule).toEqual(f);expect(result.capsuleSha256).toBe(sourceDigest(f));expect(result.counts).toEqual({pages:1,rawRows:1,unique:1,duplicates:0,inWindow:1,outOfWindow:0,read:0,unread:1,unknownRead:0});expect(result.index[0].bodySha256).toBe(sourceDigest('Private source body'));expect(JSON.stringify(result.counts)).not.toContain('private');});
 it('deduplicates equal rows regardless of object key order and rejects conflicting originals',()=>{const f=fixture();f.pages[0].body.value.push(Object.fromEntries(Object.entries(message()).reverse()));expect(validateSourceCapsule(f,expected).counts.duplicates).toBe(1);f.pages[0].body.value[1].subject='Different';rejection(f);});
 it('counts the inclusive lower and exclusive upper window without modifying raw source',()=>{const f=fixture();f.pages[0].body.value=[{...message('lower'),receivedDateTime:f.window.startUtc},{...message('upper'),receivedDateTime:f.window.endUtc},{...message('before'),receivedDateTime:'2026-10-09T10:59:59Z'}];const r=validateSourceCapsule(f,expected);expect(r.counts.inWindow).toBe(1);expect(r.counts.outOfWindow).toBe(2);expect(r.index).toHaveLength(3);});
 it('accepts a complete two-page chain with exact native outputs',()=>{const f=fixture();f.pages[0].body['@odata.nextLink']=sourceInitialUriForWindow(f.window)+'&$skiptoken=abc';f.pages.push({statusCode:200,headers:{},body:{value:[message('second')],'@odata.nextLink':null}});expect(validateSourceCapsule(f,expected).counts.pages).toBe(2);});
 it('admits only the fixed continuation scope plus one nonempty opaque token',()=>{const window=fixture().window,initial=sourceInitialUriForWindow(window);expect(validateSourceContinuation(initial+'&$skiptoken=abc%26def',window).hostname).toBe('graph.microsoft.com');for(const uri of [initial,initial+'&$skiptoken=',initial+'&$skiptoken=abc&$filter=other',initial.replace('receivedDateTime','subject')+'&$skiptoken=abc',initial+'&$skiptoken=abc\\def'])expect(()=>validateSourceContinuation(uri,window)).toThrow('SOURCE_CONTINUATION_UNSUPPORTED');});
 it('retains the existing per-native-page byte bound inside a larger aggregate',()=>{const f=fixture();f.pages[0].body.value=Array.from({length:8},(_,i)=>({...message(String(i)),body:{contentType:'text',content:'x'.repeat(32768)}}));expect(Buffer.byteLength(JSON.stringify(f))).toBeLessThan(1048576);rejection(f);});
 it.each(['https://evil.example/messages','https://graph.microsoft.com/v1.0/users/other/messages','https://graph.microsoft.com:444/v1.0/me/mailFolders/inbox/messages','https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages#fragment','https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages\n'])('refuses unsupported continuation %s',url=>expect(()=>ownerInboxUri(url)).toThrow());
 it.each([
  (f:any)=>{f.dataMode='mailbox';},(f:any)=>{f.correlationId='94887727-26ce-f111-be87-70a8a52d8f4e';},
  (f:any)=>{f.window.startUtc='2026-10-08T11:00:00Z';},(f:any)=>{f.pages[0].statusCode=429;},
  (f:any)=>{delete f.pages[0].statusCode;},(f:any)=>{f.pages[0].body.value[0].body.contentType='html';},
  (f:any)=>{f.pages[0].body.value[0].body.content='x'.repeat(32769);},(f:any)=>{f.pages[0].body['@odata.nextLink']='';},
  (f:any)=>{f.pages[0].body.error={message:'PRIVATE'};},(f:any)=>{f.pages[0].headers=null;},
  (f:any)=>{f.pages[0].body.value[0].isRead='false';},(f:any)=>{f.pages[0].body.value[0].receivedDateTime='invalid-private-date';},
  (f:any)=>{delete f.pages[0].body.value[0].hasAttachments;},
  (f:any)=>{f.pages[0].partial=false;},(f:any)=>{f.pages[0].body.truncated=true;},
  (f:any)=>{f.pages[0].body.value[0].bodyPreview='incomplete';},
  (f:any)=>{f.pages[0].body.value=Array.from({length:101},(_,i)=>message(String(i)));},
  (f:any)=>{f.pages=Array.from({length:100},()=>structuredClone(f.pages[0]));},
  (f:any)=>{f.pages[0].nativeExtra='private'.repeat(160000);},
 ])('rejects malformed, incomplete or over-budget evidence with a fixed private-safe error',mutate=>{const f=fixture();mutate(f);rejection(f);});
 it('rejects cyclic source values without exposing the underlying error',()=>{const f=fixture();f.pages[0].body.self=f;rejection(f);});
 it.each(['invalid','2026-10-22T11:00:00Z'])('refuses invalid or reversed native run windows',endedAt=>{expect(()=>validateSourceCapsule(fixture(),{...expected,endedAt})).toThrow(/^SOURCE_CAPSULE_VERIFICATION_FAILED$/);expect(()=>validateSourceRepetitions({},'Read_inbox',1,{...run,endedAt})).toThrow(/^SOURCE_REPETITION_VERIFICATION_FAILED$/);});
});

function definition():any{
 const init=(name:string,type:string,value:any)=>({type:'InitializeVariable',inputs:{variables:[{name,type,value}]}});
 const after=(name:string)=>({[name]:['Succeeded']});
 const result:any={actions:{Start:init('Run_start_utc','string','@utcNow()'),Lower:init('Window_start_utc','string',"@addDays(variables('Run_start_utc'), -14)"),Next:init('Next_page','string',sourceInitialUriTemplate),Pages:init('Source_pages','array',[]),Select_data_mode:{type:'If',expression:structuredClone(sourceMailboxGuardExpression),actions:{Read_pages:{type:'Until',expression:"@equals(variables('Next_page'), '')",limit:{count:100,timeout:'PT2M'},actions:{Read_inbox:{type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_office365',operationId:'HttpRequest'},parameters:{Method:'GET',Uri:"@variables('Next_page')",CustomHeader1:'Prefer: outlook.body-content-type="text"'}}},Validate_source_page:{type:'ParseJson',inputs:{content:"@body('Read_inbox')",schema:structuredClone(sourcePageJsonSchema)},runAfter:after('Read_inbox')},Append_source_page:{type:'AppendToArrayVariable',inputs:{name:'Source_pages',value:"@outputs('Read_inbox')"},runAfter:after('Validate_source_page')},Next_page_action:{type:'SetVariable',inputs:{name:'Next_page',value:"@coalesce(body('Read_inbox')?['@odata.nextLink'], '')"},runAfter:after('Append_source_page')}}}},else:{actions:{Fixture_source_pages:{type:'Compose',inputs:[]},Set_fixture_source_pages:{type:'SetVariable',inputs:{name:'Source_pages',value:"@outputs('Fixture_source_pages')"},runAfter:after('Fixture_source_pages')}}}},Compose_source_capsule:{type:'Compose',runAfter:after('Select_data_mode'),inputs:{schemaVersion:1,dataMode:"@triggerBody()?['dataMode']",correlationId:"@triggerBody()?['correlationId']",window:{startUtc:"@variables('Window_start_utc')",endUtc:"@variables('Run_start_utc')"},pages:"@variables('Source_pages')"}}}};
 result.actions.Lower.runAfter=after('Start');result.actions.Next.runAfter=after('Lower');result.actions.Pages.runAfter=after('Next');result.actions.Select_data_mode.runAfter=after('Pages');
 const loop=result.actions.Select_data_mode.actions.Read_pages;loop.actions={Validate_source_uri:{type:'If',expression:structuredClone(sourceUriGuardExpression),actions:loop.actions,else:{actions:{Reject_source_uri:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'SOURCE_URI_UNSUPPORTED',message:'Source continuation is unsupported'}}}}}}};
 return result;

}
describe('source dataflow subcontract — requires separate base definition admission',()=>{
 it('accepts exact source flow without claiming independent provider-value comparison',()=>{const result=assertSourceCapsuleDefinition(definition());expect(result.independentNativeRepetitionValueComparison).toBe(false);expect(result.staticActions).toBe(15);});
 it.each([
  (d:any)=>{d.actions.Select_data_mode.expression={equals:["@triggerBody()?['dataMode']",'mailbox']};},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.limit.count=101;},
  (d:any)=>{delete d.actions.Select_data_mode.actions.Read_pages.expression;},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.expression='@true';},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.limit.timeout='PT1H';},
  (d:any)=>{delete d.actions.Lower.runAfter;},(d:any)=>{delete d.actions.Next.runAfter;},
  (d:any)=>{delete d.actions.Pages.runAfter;},(d:any)=>{delete d.actions.Select_data_mode.runAfter;},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.expression={equals:[true,true]};},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.else.actions.Reject_source_uri.inputs.runStatus='Succeeded';},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Read_inbox.inputs.host.operationId='Other';},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Read_inbox.inputs.parameters.Uri='https://other';},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Validate_source_page.inputs.content="@body('Other')";},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Append_source_page.inputs.value="@body('Read_inbox')";},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Append_source_page.runAfter={Read_inbox:['Succeeded']};},
  (d:any)=>{d.actions.Compose_source_capsule.inputs.pages=[];},
  (d:any)=>{d.actions.Pages.inputs.variables[0].value=[{fake:true}];},
  (d:any)=>{d.actions.Start.inputs.variables[0].value='2026-10-23T11:00:00Z';},
  (d:any)=>{d.actions.Lower.inputs.variables[0].value="@addDays(variables('Run_start_utc'), -15)";},
  (d:any)=>{d.actions.Next.inputs.variables[0].value='https://other';},
  (d:any)=>{d.actions.Another={type:'SetVariable',inputs:{name:'Source_pages',value:[]}};},
  (d:any)=>{d.actions.Another={type:'SetVariable',inputs:{name:'source_pages',value:[]}};},
  (d:any)=>{d.actions.Another={type:'SetVariable',inputs:{name:"@concat('Source','_pages')",value:[]}};},
  (d:any)=>{d.actions.Compose_source_capsule.runtimeConfiguration={secureData:{properties:['outputs']}};},
  (d:any)=>{d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Read_inbox.runtimeConfiguration={secureData:{properties:['outputs']}};},
  (d:any)=>{delete d.actions.Select_data_mode.else.actions.Set_fixture_source_pages;},
  (d:any)=>{d.actions.Another={type:'SetVariable',inputs:{name:'Next_page',value:'other'}};},
  (d:any)=>{d.actions.Another={type:'SetVariable',inputs:{name:'Run_start_utc',value:'other'}};},
 ])('refuses altered source bindings, extra writers and hidden-source capture',mutate=>{const d=definition();mutate(d);expect(()=>assertSourceCapsuleDefinition(d)).toThrow();});
 it('bounds recursive lookup before inspecting a deeply nested source read',()=>{const d=definition(),loop=d.actions.Select_data_mode.actions.Read_pages;let actions=loop.actions;for(let i=0;i<10;i++)actions={nested:{type:'Scope',actions}};loop.actions=actions;expect(()=>assertSourceCapsuleDefinition(d)).toThrow('SOURCE_DEFINITION_DEPTH');});
 it('refuses source reads nested in an additional loop',()=>{const d=definition(),loop=d.actions.Select_data_mode.actions.Read_pages;loop.actions={nested:{type:'Foreach',actions:loop.actions}};expect(()=>assertSourceCapsuleDefinition(d)).toThrow('SOURCE_READ_LOOP_UNSUPPORTED');});
 it('allows supported input protection without claiming hidden-output access',()=>{const d=definition();d.actions.Select_data_mode.actions.Read_pages.actions.Validate_source_uri.actions.Read_inbox.runtimeConfiguration={secureData:{properties:['inputs']}};expect(()=>assertSourceCapsuleDefinition(d)).not.toThrow();});
});

function observerFixture(mode:'synthetic'|'mailbox'='synthetic'){
 const def=definition(),capsule=fixture();capsule.dataMode=mode;
 const actions=['Read_inbox','Validate_source_page','Append_source_page','Next_page_action'].map(name=>({name,status:mode==='mailbox'?'Succeeded':'Skipped'})).concat(['Fixture_source_pages','Set_fixture_source_pages'].map(name=>({name,status:mode==='synthetic'?'Succeeded':'Skipped'})),[{name:'Compose_source_capsule',status:'Succeeded'}]);
 const call=vi.fn(async(tool:string,args:any):Promise<any>=>{
  if(tool==='get_run_actions')return actions;
  if(tool==='get_run_action_content')return{action:args.action,which:'outputs',content:capsule};
  if(tool==='get_run_action_repetitions'){
   const row=repetition(0),slot=['Read_inbox','Validate_source_page','Append_source_page','Next_page_action'].indexOf(args.action);
   row.properties.startTime=`2026-10-23T11:00:0${slot}Z`;row.properties.endTime=`2026-10-23T11:00:0${slot+1}Z`;
   return{action:args.action,count:1,truncated:false,repetitions:[row]};
  }
  throw Error('Unexpected operation');
 });
 const binding={environmentId:nonce,flowId:'94887727-26ce-4111-be87-70a8a52d8f4e',runId:'native-run',nonce,dataMode:mode,definitionSha256:sourceDigest(def),...run};
 return{def,capsule,actions,call,binding,guard:vi.fn(async()=>{})};
}
describe('read-only source observation primitive, not live admission',()=>{
 it('retains synthetic source separately from metadata and never reads real repetition contents',async()=>{const f=observerFixture(),r=await observeHeadlessSource(f,f.binding,f.def,f.guard);expect(r.privateSource.capsule).toEqual(f.capsule);expect(r.receipt).toMatchObject({dataMode:'synthetic',checkerExecuted:false,successAccepted:false,independentNativeRepetitionValueComparison:false});expect(JSON.stringify(r.receipt)).not.toContain('private');expect(f.call.mock.calls.map(([tool])=>tool)).toEqual(['get_run_actions','get_run_action_content']);expect(f.guard).toHaveBeenCalledTimes(5);});
 it('uses only bounded native GET tools and matches read/validate/append ordinals',async()=>{const f=observerFixture('mailbox'),r=await observeHeadlessSource(f,f.binding,f.def,f.guard);expect(Object.keys(r.privateRepetitions)).toEqual(['Read_inbox','Validate_source_page','Append_source_page','Next_page_action']);expect(f.call.mock.calls.map(([tool])=>tool)).toEqual(['get_run_actions','get_run_action_content',...Array(4).fill('get_run_action_repetitions')]);expect(f.call.mock.calls[1][1]).toMatchObject({maxBytes:1048576,which:'outputs',action:'Compose_source_capsule'});for(const[,args]of f.call.mock.calls.slice(2))expect(args).toMatchObject({top:101,includeLinks:false});});
 it('refuses changed definitions before the first native call',async()=>{const f=observerFixture();f.def.actions.Pages.inputs.variables[0].value=['forged'];await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);expect(f.call).not.toHaveBeenCalled();});
 it('refuses stale admission before the first read',async()=>{const f=observerFixture();f.guard.mockRejectedValue(Error('private-sensitive-error'));await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);expect(f.call).not.toHaveBeenCalled();});
 it('stops on a revoked guard after a read and makes no content request',async()=>{const f=observerFixture();f.guard.mockResolvedValueOnce(undefined).mockRejectedValue(Error('revoked'));await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);expect(f.call).toHaveBeenCalledTimes(1);});
 it.each(['failed','duplicate','live-in-synthetic','missing'])('refuses %s native action evidence before content read',async mode=>{const f=observerFixture();if(mode==='failed')f.actions.at(-1)!.status='Failed';if(mode==='duplicate')f.actions.push(f.actions.at(-1)!);if(mode==='live-in-synthetic')f.actions[0].status='Succeeded';if(mode==='missing')f.actions.pop();await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);expect(f.call).toHaveBeenCalledTimes(1);});
 it('rejects an unavailable source envelope without logging provider contents',async()=>{const f=observerFixture();f.call.mockImplementation(async tool=>tool==='get_run_actions'?f.actions:{action:'Compose_source_capsule',which:'outputs',skipped:true,private:'PRIVATE'});await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);});
 it('rejects conflicting envelope indicators even when content is present',async()=>{const f=observerFixture(),original=f.call.getMockImplementation()!;f.call.mockImplementation(async(tool,args)=>{const result=await original(tool,args);if(tool==='get_run_action_content')result.truncated=false;return result;});await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);});
 it('rejects the next read before the previous continuation update completes',async()=>{const f=observerFixture('mailbox'),original=f.call.getMockImplementation()!;f.capsule.pages[0].body['@odata.nextLink']=sourceInitialUriForWindow(f.capsule.window)+'&$skiptoken=second';f.capsule.pages.push({statusCode:200,headers:{},body:{value:[message('second')]}});f.call.mockImplementation(async(tool,args)=>{const result=await original(tool,args);if(tool==='get_run_action_repetitions'){const row=structuredClone(result.repetitions[0]);row.name='second-'+args.action;row.properties.repetitionIndexes[0].itemIndex=1;row.properties.startTime='2026-10-23T11:00:03Z';row.properties.endTime='2026-10-23T11:00:04Z';result.count=2;result.repetitions.push(row);}return result;});await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);});
 it('rejects validation occurring before the original read completes',async()=>{const f=observerFixture('mailbox'),original=f.call.getMockImplementation()!;f.call.mockImplementation(async(tool,args)=>{const value=await original(tool,args);if(tool==='get_run_action_repetitions'&&args.action==='Validate_source_page')value.repetitions[0].properties.startTime=run.startedAt;return value;});await expect(observeHeadlessSource(f,f.binding,f.def,f.guard)).rejects.toThrow(/^SOURCE_OBSERVATION_FAILED_CONTENT_WITHHELD$/);});
});
function repetition(index:number):any{return{name:'native-'+index,properties:{status:'Succeeded',startTime:`2026-10-23T11:00:0${index}Z`,endTime:`2026-10-23T11:00:0${index+1}Z`,repetitionIndexes:[{scopeName:'Read_pages',itemIndex:index}],inputsLink:{uri:'private-link'},outputs:{private:'do not return'}}};}
describe('native repetition evidence',()=>{
 it('sorts contiguous ordinals and returns whitelisted metadata only',()=>{const r=validateSourceRepetitions({action:'Read_inbox',count:2,truncated:false,repetitions:[repetition(1),repetition(0)]},'Read_inbox',2,run);expect(r.map(x=>x.index)).toEqual([0,1]);expect(JSON.stringify(r)).not.toContain('private');});
 it.each([
  (f:any)=>{f.truncated=true;},(f:any)=>{f.count=3;},(f:any)=>{f.action='Other';},
  (f:any)=>{f.repetitions[1].properties.status='Failed';},(f:any)=>{f.repetitions[1].properties.repetitionIndexes[0].itemIndex=0;},
  (f:any)=>{f.repetitions[1].name=f.repetitions[0].name;},(f:any)=>{f.repetitions[1].properties.startTime=run.startedAt;},
  (f:any)=>{f.repetitions[0].properties.startTime='2026-10-22T11:00:00Z';},
 ])('rejects incomplete, replayed or overlapping metadata',mutate=>{const f={action:'Read_inbox',count:2,truncated:false,repetitions:[repetition(0),repetition(1)]};mutate(f);expect(()=>validateSourceRepetitions(f,'Read_inbox',2,run)).toThrow(/^SOURCE_REPETITION_VERIFICATION_FAILED$/);});
});

