import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';

export const SOURCE_CAPSULE_BYTES=1024*1024;
/** Retain the existing per-native-output capture limit inside the aggregate. */
export const SOURCE_PAGE_BYTES=256000;
export const SOURCE_PROTOCOL='whole-native-output-capsule-v1' as const;
export const sourceNames={array:'Source_pages',loop:'Read_pages',read:'Read_inbox',validate:'Validate_source_page',append:'Append_source_page',fixture:'Fixture_source_pages',setFixture:'Set_fixture_source_pages',uriGuard:'Validate_source_uri',capsule:'Compose_source_capsule',mode:'Select_data_mode',next:'Next_page',nextAction:'Next_page_action',start:'Run_start_utc',lower:'Window_start_utc'} as const;
export const sourceSelect='id,internetMessageId,receivedDateTime,sender,subject,isRead,body,hasAttachments,webLink';
export const sourceInitialUriTemplate=`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=100&$select=${sourceSelect}&$filter=@{encodeUriComponent(concat('receivedDateTime ge ', variables('Window_start_utc'), ' and receivedDateTime lt ', variables('Run_start_utc')))}`;
export const sourceInitialUriExpression=`concat('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=100&$select=${sourceSelect}&$filter=', encodeUriComponent(concat('receivedDateTime ge ', variables('Window_start_utc'), ' and receivedDateTime lt ', variables('Run_start_utc'))))`;
/** Conservative query profile: exact initial scope plus one opaque skip token.
 * A provider ordering/encoding variant fails before GET, rather than being guessed. */
export const sourceUriGuardExpression={and:[{or:[{equals:["@variables('Next_page')",`@${sourceInitialUriExpression}`]},{and:[{equals:["@length(split(uriQuery(variables('Next_page')), '&'))",4]},{equals:[`@startsWith(variables('Next_page'), concat(${sourceInitialUriExpression}, '&$skiptoken='))`,true]},{not:{equals:["@variables('Next_page')",`@concat(${sourceInitialUriExpression}, '&$skiptoken=')`]}}]}]},...['#','\\'].map(character=>({equals:[`@contains(variables('Next_page'), '${character}')`,false]})),...['%0D','%0A','%09'].map(encoded=>({equals:[`@contains(variables('Next_page'), uriComponentToString('${encoded}'))`,false]}))]};

export const sourceDigest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash=z.string().regex(/^[a-f0-9]{64}$/);
/** Optional new capability; a plan must explicitly select this reviewed method.
 * Its source-only cap does not change report, transport, timing or planning caps. */
export const sourceCaptureSchema=z.strictObject({kind:z.literal(SOURCE_PROTOCOL),recordId:z.uuid(),checker:z.strictObject({script:z.literal('scripts/qa/verify-private.mjs'),sha256:hash,specificationSha256:hash})});
export type SourceCapture=z.infer<typeof sourceCaptureSchema>;
export const sourcePageJsonSchema={type:'object',required:['value'],properties:{value:{type:'array',maxItems:100,items:{type:'object',required:['id','receivedDateTime','sender','subject','isRead','hasAttachments','body'],properties:{id:{type:'string',minLength:1},receivedDateTime:{type:'string',format:'date-time'},sender:{type:'object',required:['emailAddress'],properties:{emailAddress:{type:'object',required:['address'],properties:{address:{type:'string'}}}}},subject:{type:'string',maxLength:1024},isRead:{type:'boolean'},hasAttachments:{type:'boolean'},body:{type:'object',additionalProperties:false,required:['contentType','content'],properties:{contentType:{type:'string',enum:['text']},content:{type:'string',maxLength:32768}}},internetMessageId:{type:['string','null']},webLink:{type:['string','null']}}}},'@odata.nextLink':{type:['string','null']}}} as const;
const object=(value:unknown):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('SOURCE_DEFINITION_UNSUPPORTED');return value as Record<string,any>;};
const same=isDeepStrictEqual;
const after=(action:Record<string,any>,name:string)=>same(action.runAfter,{[name]:['Succeeded']});

/** Exact dataflow, not a taint workaround or an independent provider-value read.
 * Independent QA must accept this provenance method and visibility baseline. */
export function assertSourceCapsuleDefinition(value:unknown){
 const definition=object(value),top=object(definition.actions),mode=object(top[sourceNames.mode]);
 if(mode.type!=='If'||!same(mode.expression,{equals:["@triggerBody()?['dataMode']",'mailbox']}))throw Error('SOURCE_MODE_GUARD_REQUIRED');
 const live=object(mode.actions),loop=object(live[sourceNames.loop]);
 if(loop.expression!=="@equals(variables('Next_page'), '')"||loop.limit?.timeout!=='PT2M')throw Error('SOURCE_TERMINATION_REQUIRED');
 const locations:{parent:Record<string,any>;action:Record<string,any>;loops:number}[]=[];
 let located=0;const locate=(actions:Record<string,any>,loops:number,depth=1)=>{if(depth>8)throw Error('SOURCE_DEFINITION_DEPTH');for(const[name,raw]of Object.entries(actions)){if(++located>500)throw Error('SOURCE_DEFINITION_SIZE_OR_DUPLICATE');const a=object(raw);if(name===sourceNames.read)locations.push({parent:actions,action:a,loops});const nested=loops+Number(['Foreach','Until'].includes(a.type));if(a.actions)locate(object(a.actions),nested,depth+1);if(a.else?.actions)locate(object(a.else.actions),nested,depth+1);for(const branch of Object.values(a.cases??{}))if((branch as any)?.actions)locate(object((branch as any).actions),nested,depth+1);if(a.default?.actions)locate(object(a.default.actions),nested,depth+1);}};locate(object(loop.actions),0);
 if(locations.length!==1||locations[0].loops)throw Error('SOURCE_READ_LOOP_UNSUPPORTED');
 const page=locations[0].parent,read=locations[0].action,uriGuard=object(object(loop.actions)[sourceNames.uriGuard]),validate=object(page[sourceNames.validate]),append=object(page[sourceNames.append]);
 if(loop.type!=='Until'||loop.limit?.count!==100||read.type!=='OpenApiConnection'||read.inputs?.host?.apiId!=='/providers/Microsoft.PowerApps/apis/shared_office365'||read.inputs?.host?.operationId!=='HttpRequest'||read.inputs?.parameters?.Method!=='GET'||read.inputs?.parameters?.Uri!=="@variables('Next_page')"||read.inputs?.parameters?.CustomHeader1!=='Prefer: outlook.body-content-type="text"')throw Error('SOURCE_NATIVE_READ_BINDING_REQUIRED');
 if(validate.type!=='ParseJson'||validate.inputs?.content!=="@body('Read_inbox')"||!same(validate.inputs?.schema,sourcePageJsonSchema)||!after(validate,sourceNames.read))throw Error('SOURCE_NATIVE_VALIDATION_REQUIRED');
 if(append.type!=='AppendToArrayVariable'||!same(append.inputs,{name:sourceNames.array,value:"@outputs('Read_inbox')"})||!after(append,sourceNames.validate))throw Error('SOURCE_UNCHANGED_APPEND_REQUIRED');
 if(uriGuard.type!=='If'||!same(uriGuard.expression,sourceUriGuardExpression)||uriGuard.actions!==page||!same(uriGuard.else?.actions,{Reject_source_uri:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'SOURCE_URI_UNSUPPORTED',message:'Source continuation is unsupported'}}}}))throw Error('SOURCE_PRE_READ_URI_GUARD_REQUIRED');
 const next=Object.values(page).filter(a=>a?.type==='SetVariable'&&a.inputs?.name===sourceNames.next);
 if(page[sourceNames.nextAction]!==next[0]||next.length!==1||next[0].inputs.value!=="@coalesce(body('Read_inbox')?['@odata.nextLink'], '')"||!after(next[0],sourceNames.append))throw Error('SOURCE_CONTINUATION_ORDER_REQUIRED');
 const other=object(mode.else?.actions),fixture=object(other[sourceNames.fixture]),setFixture=object(other[sourceNames.setFixture]);
 if(fixture.type!=='Compose'||setFixture.type!=='SetVariable'||!same(setFixture.inputs,{name:sourceNames.array,value:"@outputs('Fixture_source_pages')"})||!after(setFixture,sourceNames.fixture))throw Error('SOURCE_SYNTHETIC_BRANCH_REQUIRED');
 const capsule=object(top[sourceNames.capsule]);
 const input={schemaVersion:1,dataMode:"@triggerBody()?['dataMode']",correlationId:"@triggerBody()?['correlationId']",window:{startUtc:"@variables('Window_start_utc')",endUtc:"@variables('Run_start_utc')"},pages:"@variables('Source_pages')"};
 if(capsule.type!=='Compose'||!same(capsule.inputs,input)||!after(capsule,sourceNames.mode))throw Error('SOURCE_CAPSULE_BINDING_REQUIRED');
 let count=0,initializers=0,starts=0,lowers=0,nextInitializers=0;const names=new Set<string>(),initialization=new Map<string,{name:string;action:Record<string,any>}>();
 const walk=(actions:Record<string,any>,depth:number)=>{if(depth>8)throw Error('SOURCE_DEFINITION_DEPTH');for(const[name,raw]of Object.entries(actions)){const a=object(raw);if(names.has(name)||++count>500)throw Error('SOURCE_DEFINITION_SIZE_OR_DUPLICATE');names.add(name);
  const variableName=(name:unknown)=>{if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))throw Error('SOURCE_DYNAMIC_VARIABLE_NAME');for(const reserved of [sourceNames.array,sourceNames.start,sourceNames.lower,sourceNames.next])if(name.toUpperCase()===reserved.toUpperCase()&&name!==reserved)throw Error('SOURCE_VARIABLE_ALIAS');};
  if(['SetVariable','AppendToArrayVariable','AppendToStringVariable','IncrementVariable','DecrementVariable'].includes(a.type))variableName(a.inputs?.name);
  if(a.type==='InitializeVariable')for(const variable of a.inputs?.variables??[]){variableName(variable.name);if(Object.values(sourceNames).includes(variable.name)){if(a.inputs.variables.length!==1)throw Error('SOURCE_INITIALIZER_CHAIN_REQUIRED');initialization.set(variable.name,{name,action:a});}}
  if(a.type==='InitializeVariable')for(const variable of a.inputs?.variables??[]){if(variable.name===sourceNames.array){initializers++;if(actions!==top||variable.type!=='array'||!same(variable.value,[]))throw Error('SOURCE_ARRAY_INITIALIZER_REQUIRED');}if(variable.name===sourceNames.start){starts++;if(actions!==top||variable.type!=='string'||variable.value!=='@utcNow()')throw Error('SOURCE_WINDOW_BINDING_REQUIRED');}if(variable.name===sourceNames.lower){lowers++;if(actions!==top||variable.type!=='string'||variable.value!=="@addDays(variables('Run_start_utc'), -14)")throw Error('SOURCE_WINDOW_BINDING_REQUIRED');}}
  if(a.type==='InitializeVariable')for(const variable of a.inputs?.variables??[])if(variable.name===sourceNames.next){nextInitializers++;if(actions!==top||variable.type!=='string'||variable.value!==sourceInitialUriTemplate)throw Error('SOURCE_INITIAL_QUERY_REQUIRED');}
  if(a.inputs?.name===sourceNames.array&&a.type!=='InitializeVariable'&&a!==append&&a!==setFixture)throw Error('SOURCE_ARRAY_HAS_ANOTHER_WRITER');
  if([sourceNames.start,sourceNames.lower].includes(a.inputs?.name)&&a.type!=='InitializeVariable')throw Error('SOURCE_WINDOW_HAS_ANOTHER_WRITER');
  if(a.inputs?.name===sourceNames.next&&a.type!=='InitializeVariable'&&a!==next[0])throw Error('SOURCE_CONTINUATION_HAS_ANOTHER_WRITER');
  if([mode,loop,uriGuard,validate,append,setFixture,capsule].includes(a)&&(a.runtimeConfiguration?.secureData?.properties?.length??0))throw Error('SOURCE_CAPTURE_VISIBILITY_UNAVAILABLE');
  if(a===read&&a.runtimeConfiguration?.secureData?.properties?.some((p:unknown)=>p!=='inputs'))throw Error('SOURCE_CAPTURE_VISIBILITY_UNAVAILABLE');
  if(a.actions)walk(object(a.actions),depth+1);if(a.else?.actions)walk(object(a.else.actions),depth+1);for(const branch of Object.values(a.cases??{}))if((branch as any)?.actions)walk(object((branch as any).actions),depth+1);if(a.default?.actions)walk(object(a.default.actions),depth+1);
 }};walk(top,1);
 if(initializers!==1||starts!==1||lowers!==1||nextInitializers!==1)throw Error('SOURCE_INITIALIZERS_REQUIRED');
 const chain=[sourceNames.start,sourceNames.lower,sourceNames.next,sourceNames.array];for(let i=1;i<chain.length;i++){const current=initialization.get(chain[i]),previous=initialization.get(chain[i-1]);if(!current||!previous||!after(current.action,previous.name))throw Error('SOURCE_INITIALIZER_CHAIN_REQUIRED');}if(!after(mode,initialization.get(sourceNames.array)!.name))throw Error('SOURCE_INITIALIZER_CHAIN_REQUIRED');
 return{method:SOURCE_PROTOCOL,staticActions:count,sourcePageSchemaSha256:sourceDigest(sourcePageJsonSchema),independentNativeRepetitionValueComparison:false};
}

/** Microsoft exposes these ordinal/status properties; this does not infer
 * Power Automate payload availability from the separate Logic Apps SDK docs. */
export function validateSourceRepetitions(raw:unknown,action:string,pages:number,run:{startedAt:string;endedAt:string}){
 try{
  utc.parse(run.startedAt);utc.parse(run.endedAt);if(Date.parse(run.endedAt)<Date.parse(run.startedAt))throw Error('SOURCE_RUN_WINDOW');
  const proof=z.object({action:z.literal(action),count:z.number().int().nonnegative(),truncated:z.literal(false),repetitions:z.array(z.object({name:z.string().min(1),properties:z.object({status:z.literal('Succeeded'),startTime:utc,endTime:utc,repetitionIndexes:z.array(z.strictObject({scopeName:z.literal(sourceNames.loop),itemIndex:z.number().int().min(0).max(99)})).length(1)}).passthrough()}).passthrough()).max(100)}).parse(raw);
  if(proof.count!==proof.repetitions.length||proof.count!==pages||pages<1||pages>=100)throw Error('SOURCE_REPETITION_COUNT');
  const ordered=proof.repetitions.map(row=>({name:row.name,index:row.properties.repetitionIndexes[0].itemIndex,startTime:row.properties.startTime,endTime:row.properties.endTime})).sort((a,b)=>a.index-b.index);
  if(new Set(ordered.map(row=>row.name)).size!==pages||ordered.some((row,i)=>row.index!==i||Date.parse(row.startTime)<Date.parse(run.startedAt)||Date.parse(row.endTime)>Date.parse(run.endedAt)||Date.parse(row.endTime)<Date.parse(row.startTime)||i>0&&Date.parse(row.startTime)<Date.parse(ordered[i-1].endTime)))throw Error('SOURCE_REPETITION_ORDER');
  return ordered;
 }catch{throw Error('SOURCE_REPETITION_VERIFICATION_FAILED');}
}

const utc=z.iso.datetime({offset:true}).refine(value=>/(?:Z|\+00:00)$/.test(value)&&Number.isFinite(Date.parse(value)));
const message=z.object({id:z.string().min(1),receivedDateTime:utc,sender:z.object({emailAddress:z.object({address:z.string()}).passthrough()}).passthrough(),subject:z.string().max(1024),isRead:z.boolean(),hasAttachments:z.boolean(),body:z.strictObject({contentType:z.literal('text'),content:z.string().max(32768)}),internetMessageId:z.string().nullable().optional(),webLink:z.string().nullable().optional()}).passthrough();
const pageBody=z.object({value:z.array(message).max(100),'@odata.nextLink':z.string().nullable().optional()}).passthrough();
export const sourceCapsuleSchema=z.strictObject({schemaVersion:z.literal(1),dataMode:z.enum(['mailbox','synthetic']),correlationId:z.uuid(),window:z.strictObject({startUtc:utc,endUtc:utc}),pages:z.array(z.object({statusCode:z.literal(200),headers:z.record(z.string(),z.unknown()),body:pageBody}).passthrough()).min(1).max(100)});
export type SourceCapsule=z.infer<typeof sourceCapsuleSchema>;
export function sourceInitialUriForWindow(window:{startUtc:string;endUtc:string}){
 return `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=100&$select=${sourceSelect}&$filter=${encodeURIComponent(`receivedDateTime ge ${window.startUtc} and receivedDateTime lt ${window.endUtc}`)}`;
}
export function validateSourceContinuation(raw:string,window:{startUtc:string;endUtc:string}){
 const uri=ownerInboxUri(raw),prefix=sourceInitialUriForWindow(window)+'&$skiptoken=';
 if(!raw.toLowerCase().startsWith(prefix.toLowerCase())||raw.length<=prefix.length||uri.search.split('&').length!==4||raw.includes('\\'))throw Error('SOURCE_CONTINUATION_UNSUPPORTED');
 return uri;
}
export function ownerInboxUri(raw:string){
 if(!/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/mailFolders\/inbox\/messages(?:\?|$)/i.test(raw)||/[\x00-\x1f\x7f]/.test(raw))throw Error('SOURCE_CONTINUATION_UNSUPPORTED');
 const uri=new URL(raw);if(uri.username||uri.password||uri.port||uri.hash)throw Error('SOURCE_CONTINUATION_UNSUPPORTED');return uri;
}
/** Selectors describe a single explicit source shape. Unknown envelopes fail;
 * no recursive unwrapping, preview fallback or partial-success coercion. */
export function validateSourceCapsule(raw:unknown,expected:{dataMode:'mailbox'|'synthetic';nonce:string;startedAt:string;endedAt:string}){
 try{
  utc.parse(expected.startedAt);utc.parse(expected.endedAt);if(Date.parse(expected.endedAt)<Date.parse(expected.startedAt))throw Error('SOURCE_RUN_WINDOW');
  if(Buffer.byteLength(JSON.stringify(raw))>SOURCE_CAPSULE_BYTES)throw Error('SOURCE_CAPSULE_OVERSIZE');
  const capsule=structuredClone(raw) as SourceCapsule;sourceCapsuleSchema.parse(capsule);const lower=Date.parse(capsule.window.startUtc),upper=Date.parse(capsule.window.endUtc);
  if(capsule.dataMode!==expected.dataMode||capsule.correlationId!==expected.nonce||upper-lower!==14*86400000||upper<Date.parse(expected.startedAt)||upper>Date.parse(expected.endedAt)||capsule.pages.length>=100)throw Error('SOURCE_SCOPE_OR_WINDOW_DIFFERS');
  const links=new Set<string>(),seen=new Map<string,unknown>();let rawRows=0,duplicates=0,inWindow=0,read=0,unread=0;const index:{page:number;row:number;sourceId:string;receivedUtc:string;bodySha256:string}[]=[];
  for(const[ordinal,page]of capsule.pages.entries()){
   if(Buffer.byteLength(JSON.stringify(page))>SOURCE_PAGE_BYTES)throw Error('SOURCE_PAGE_OVERSIZE');
   if(['error','truncated','preview','partial','skipped'].some(key=>Object.hasOwn(page,key)||Object.hasOwn(page.body,key)))throw Error('SOURCE_PAGE_INVALID');
   const next=page.body['@odata.nextLink'];if(ordinal<capsule.pages.length-1){if(typeof next!=='string'||links.has(next))throw Error('SOURCE_CHAIN_INCOMPLETE');validateSourceContinuation(next,capsule.window);links.add(next);}else if(next!==undefined&&next!==null)throw Error('SOURCE_CHAIN_INCOMPLETE');
   for(const[row,m]of page.body.value.entries()){if(['error','truncated','preview','partial','skipped','bodyPreview'].some(key=>Object.hasOwn(m,key)))throw Error('SOURCE_MESSAGE_INCOMPLETE');rawRows++;if(seen.has(m.id)){if(!same(seen.get(m.id),m))throw Error('SOURCE_CONFLICTING_DUPLICATE');duplicates++;continue;}seen.set(m.id,m);if(seen.size>=10000)throw Error('SOURCE_SATURATED');const at=Date.parse(m.receivedDateTime);if(at>=lower&&at<upper){inWindow++;if(m.isRead)read++;else unread++;}index.push({page:ordinal,row,sourceId:m.id,receivedUtc:m.receivedDateTime,bodySha256:sourceDigest(m.body.content)});}
  }
  return{capsule,index,counts:{pages:capsule.pages.length,rawRows,unique:seen.size,duplicates,inWindow,outOfWindow:seen.size-inWindow,read,unread,unknownRead:0},capsuleSha256:sourceDigest(capsule)};
 }catch{throw Error('SOURCE_CAPSULE_VERIFICATION_FAILED');}
}
