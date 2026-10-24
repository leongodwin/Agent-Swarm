import crypto from 'node:crypto';
import {inspectStandaloneProbeAdapter} from './standaloneProbeAdapter.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {nativeReviewCapsule} from './nativeReviewCapsule.ts';

const sha=(value:string|Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex');
export const nativeReviewTools=['whoami','list_connections','read_standalone_flow_owners','get_flow','get_run_history','list_flows','preflight_flow','create_standalone_flow','get_flow_context','publish_flow','run_flow','disable_flow','get_run_actions','get_run_action_content'] as const;
export const nativeReviewMethods=["listFlows","getFlow","createFlow","assertNoDuplicateDisplayName","publishFlow","disableFlow","triggerFlowRun","getRunHistory","getRunDetails","getRunActionDetails","getRunActionContent","preflightFlow","listConnections","getFlowContext","assertNotManaged","adminGetFlowPermissions","dataverseGet","ppapiOperationRequest","ppapiRequest","ppapiRequestWithFallback","requestWithToken","request","ppapiBase","ppapiFlowQs","classicFlowRpRequest","resolveTrigger","runFlowViaLogicFlowsConnector","constructor","getConnections","getConnection","getDataverseInstanceUrl","isPpapiDnsFailure","getCachedConnections","setCachedConnections","get","isCdsPermissionError","resolveTriggerName","connectivityRequest","getEnvironment"] as const;
export const nativeReviewFunctions=["admitStandaloneProvider","fetchContentLink","fetchWithNetworkError","assertTriggerInputsSatisfied","safeResult","safeError","followPagination","dataverseConnectionReferencesUrl","extractLogicalNamesFromFlow","dataverseWorkflowUrl","dataverseWorkflowByUniqueUrl","dataverseSolutionByIdUrl","adminFlowPermissionsUrl","ppapiBaseUrl","ppapiConnectorUrl","ppapiConnectionsUrl","ppapiConnectionUrl","environmentUrl","whoAmI","isNotFoundError","notFoundResult","summarizeList","injectTemplateMetadata","readContentText","parseContentText","hostnameOf","explain","safeErrorName","escapeODataString","qs","resolveShardLength","ppapiFlowQs","connQs","readActiveAzIdentity","readTokenIdentity","compareTokenIdentity","readCachedMsalIdentities","effectiveConnectivityIdentity","azureConfigDir","defaultCacheDir","defaultMsalCacheDir","connectivityIdentityMismatch","getNestedValue","parseJwtClaims","normalizeIdentity","safeIdentity","isTokenCacheFile","selectCachedMsalAccount","enhanceFlowApiError"] as const;
export const nativeReviewConstants=["MAX_RETRIES","INITIAL_DELAY_MS","LOGIC_FLOWS_CONNECTOR","APIHUB_RESOURCE","MAX_SINGLE_ITEM_CHARS","MAX_RESPONSE_CHARS","DEFAULT_MAX_PAGES","PPAPI_DEFAULT_SUFFIX","FLOWAGENT_TEMPLATE_ID","API_VERSION","PPAPI_DEFAULT_SHARD_LENGTH","PPAPI_API_VERSION","PREFERRED_ACCOUNT_FILE"] as const;
export const nativeReviewClasses=["DuplicateFlowError","ManagedSolutionError","FlowApiError","TriggerInputError","InvalidEnvironmentIdError"] as const;
/** Select complete fixed handlers/methods from the exact compiled entry. This
 * does not claim to reproduce unrelated tools or the bundled MSAL/MCP libraries. */
export function nativeReviewComponents(source:string,expected:string){
 if(sha(source)!==expected)throw Error('Native review entry changed');
 const unique=(needle:string,from=0)=>{const first=source.indexOf(needle,from);if(first<0||source.indexOf(needle,first+needle.length)>=0)throw Error('Native review component absent or ambiguous');return first;};
 const component=(name:string,start:number,end:number)=>{const text=source.slice(start,end);if(end<=start||Buffer.byteLength(text)>128*1024)throw Error('Native component exceeds review bound');return{name,entrySha256:expected,startCharacter:start,endCharacter:end,sha256:sha(text),text};};
 const result=[];
 // Full bundled validation module includes its exports, validator body and lazy
 // initializer. Keep bundler helpers and cache initializer dependencies visible.
 for(const [name,begin,end] of [
  ['bundler-runtime','var __create = Object.create;','// packages/core/dist/utils/logger.js'],
  ['flow-definition-module','// packages/core/dist/validation/flow-definition.js','// packages/core/dist/auth/clear-cache-files.js'],
  ['cache-initialization-module','// packages/core/dist/auth/clear-cache-files.js','// packages/core/dist/auth/auth-operation-queue.js'],
 ] as const){const start=unique(begin),finish=unique(end,start+begin.length);result.push(component('module:'+name,start,finish));}

 for(const tool of nativeReviewTools){const start=unique(`  server2.tool("${tool}",`),end=source.indexOf('\n  server2.tool(',start+1);if(end<0)throw Error('Native tool boundary missing');result.push(component('tool:'+tool,start,end));}
 const classStart=unique('var FlowClient = class _FlowClient {'),classEnd=source.indexOf('\n};',classStart);if(classEnd<0)throw Error('Native client boundary missing');
 const client=source.slice(classStart,classEnd);
 const constructor=client.indexOf('  constructor(');if(constructor<0)throw Error('Native client initialization absent');
 result.push(component('client-state',classStart,classStart+constructor));
 for(const method of nativeReviewMethods){const pattern=new RegExp('^  (?:async )?'+method+'\\(','gm'),matches=[...client.matchAll(pattern)];if(matches.length!==1)throw Error('Native client method absent or ambiguous');const start=classStart+matches[0].index!,match=/\r?\n  \}(?:\r?\n|;)/.exec(source.slice(start));if(!match)throw Error('Native method boundary missing');result.push(component('method:'+method,start,start+match.index+match[0].length));}
 for(const name of nativeReviewFunctions){const matches=[...source.matchAll(new RegExp('^(?:async )?function '+name+'\\(','gm'))];if(matches.length!==1)throw Error('Native function absent or ambiguous');const start=matches[0].index!,match=/\r?\n\}\r?\n/.exec(source.slice(start));if(!match)throw Error('Native function boundary missing');result.push(component('function:'+name,start,start+match.index+match[0].length));}
 for(const name of nativeReviewClasses){const start=unique('var '+name+' = class '),end=source.indexOf('\n};',start);if(end<0)throw Error('Native error class boundary missing');result.push(component('class:'+name,start,end+4));}
 for(const name of nativeReviewConstants){const matches=[...source.matchAll(new RegExp('^var '+name+'(?: =|;)','gm'))];if(matches.length!==1)throw Error('Native constant absent or ambiguous');const start=matches[0].index!;let end=source.indexOf('\n',start);if(name==='PREFERRED_ACCOUNT_FILE'){const initializer=unique('var init_msal_disk_cache = __esm({',start);end=source.indexOf('\n});',initializer);if(end<0)throw Error('Native cache constant initializer absent');end+=5;}if(end<0)throw Error('Native constant boundary missing');result.push(component('constant:'+name,start,end));}
 // Regression checks for direct calls and named callback arguments, not a
 // general proof of dynamic JavaScript closure. Exact code still needs review.
 const methods=new Set([...client.matchAll(/^  (?:async )?(\w+)\(/gm)].map(m=>m[1])),functions=new Set([...source.matchAll(/^(?:async )?function (\w+)\(/gm)].map(m=>m[1])),included=new Set(result.map(p=>p.name));
 for(const part of result.filter(p=>p.name.startsWith('module:')))for(const match of part.text.matchAll(/^(?:async )?function (\w+)\(/gm))included.add('function:'+match[1]);
 const initializers=new Set([...source.matchAll(/^var (init_\w+) = __esm\(/gm)].map(m=>m[1])),exposedInitializers=new Set(result.flatMap(p=>[...p.text.matchAll(/^var (init_\w+) = __esm\(/gm)].map(m=>m[1])));
 for(const part of result){for(const match of part.text.matchAll(/\b(init_\w+)\s*\(/g))if(initializers.has(match[1])&&!exposedInitializers.has(match[1]))throw Error('Executed native initializer omitted: '+match[1]);if(part.name.startsWith('module:'))continue;for(const match of part.text.matchAll(/\bthis\.(\w+)\s*\(/g))if(methods.has(match[1])&&!included.has('method:'+match[1]))throw Error('Executed native method omitted');for(const pattern of [/(?<![.\w])(\w+)\s*\(/g,/\bsafeError\s*\([^,\n]*,\s*(\w+)\s*\)/g])for(const match of part.text.matchAll(pattern))if(functions.has(match[1])&&!included.has('function:'+match[1]))throw Error('Executed native helper omitted: '+match[1]);}
 return result;
}
export async function standaloneNativeReviewSources(home:string,expected:string){
 const inspected=await inspectStandaloneProbeAdapter(home,expected),bytes=await readBoundedBytes(inspected.entry,8*1024*1024);if(!bytes)throw Error('Native review entry unavailable');
 // A single exact entry hash binds every component in this capsule. Avoid
 // repeating that same hash per item; retain every byte, offset and item hash.
 const source=new TextDecoder('utf8',{fatal:true}).decode(bytes),components=nativeReviewComponents(source,expected).map(({entrySha256:_entry,...component})=>component),groups:typeof components[]=[];let current:typeof components=[];
 for(const item of components){if(Buffer.byteLength(nativeReviewCapsule(expected,[...current,item]))>110*1024){if(!current.length||Buffer.byteLength(nativeReviewCapsule(expected,[item]))>110*1024)throw Error('Native review component cannot fit');groups.push(current);current=[];}current.push(item);}if(current.length)groups.push(current);
 return groups.map((sources,index)=>{const text=nativeReviewCapsule(expected,sources);return {file:`docs/STANDALONE-NATIVE-SOURCES-${index+1}.md`,sha256:sha(text),text};});
}
