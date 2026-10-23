import crypto from 'node:crypto';
import {inspectStandaloneProbeAdapter} from './standaloneProbeAdapter.ts';
import {readBoundedBytes} from './boundedJson.ts';

const sha=(value:string|Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex');
export const nativeReviewTools=['whoami','list_connections','read_standalone_flow_owners','get_flow','get_run_history','list_flows','preflight_flow','create_standalone_flow','get_flow_context','publish_flow','run_flow','disable_flow','get_run_actions','get_run_action_content'] as const;
export const nativeReviewMethods=['listFlows','getFlow','createFlow','assertNoDuplicateDisplayName','publishFlow','disableFlow','triggerFlowRun','getRunHistory','getRunActionDetails','getRunActionContent','preflightFlow','listConnections','getFlowContext','assertNotManaged','adminGetFlowPermissions','dataverseGet','ppapiOperationRequest','ppapiRequest','ppapiRequestWithFallback','requestWithToken','request','ppapiBase','ppapiFlowQs','classicFlowRpRequest','resolveTrigger','runFlowViaLogicFlowsConnector'] as const;
/** Select complete fixed handlers/methods from the exact compiled entry. This
 * does not claim to reproduce unrelated tools or the bundled MSAL/MCP libraries. */
export function nativeReviewComponents(source:string,expected:string){
 if(sha(source)!==expected)throw Error('Native review entry changed');
 const unique=(needle:string,from=0)=>{const first=source.indexOf(needle,from);if(first<0||source.indexOf(needle,first+needle.length)>=0)throw Error('Native review component absent or ambiguous');return first;};
 const component=(name:string,start:number,end:number)=>{const text=source.slice(start,end);if(end<=start||Buffer.byteLength(text)>128*1024)throw Error('Native component exceeds review bound');return{name,entrySha256:expected,startCharacter:start,endCharacter:end,sha256:sha(text),text};};
 const result=[];
 for(const tool of nativeReviewTools){const start=unique(`  server2.tool("${tool}",`),end=source.indexOf('\n  server2.tool(',start+1);if(end<0)throw Error('Native tool boundary missing');result.push(component('tool:'+tool,start,end));}
 const classStart=unique('var FlowClient = class _FlowClient {'),classEnd=source.indexOf('\n};',classStart);if(classEnd<0)throw Error('Native client boundary missing');
 const client=source.slice(classStart,classEnd);
 for(const method of nativeReviewMethods){const pattern=new RegExp('^  (?:async )?'+method+'\\(','gm'),matches=[...client.matchAll(pattern)];if(matches.length!==1)throw Error('Native client method absent or ambiguous');const start=classStart+matches[0].index!,match=/\r?\n  \}(?:\r?\n|;)/.exec(source.slice(start));if(!match)throw Error('Native method boundary missing');result.push(component('method:'+method,start,start+match.index+match[0].length));}
 for(const name of ['fetchContentLink','fetchWithNetworkError','assertTriggerInputsSatisfied','safeResult','safeError']){const prefix=['fetchContentLink','fetchWithNetworkError'].includes(name)?'async function ':'function ',start=unique(prefix+name+'('),match=/\r?\n\}(?:\r?\n|;)/.exec(source.slice(start));if(!match)throw Error('Native function boundary missing');result.push(component('function:'+name,start,start+match.index+match[0].length));}
 return result;
}
export async function standaloneNativeReviewSources(home:string,expected:string){
 const inspected=await inspectStandaloneProbeAdapter(home,expected),bytes=await readBoundedBytes(inspected.entry,8*1024*1024);if(!bytes)throw Error('Native review entry unavailable');
 const source=new TextDecoder('utf8',{fatal:true}).decode(bytes),components=nativeReviewComponents(source,expected),groups:typeof components[]=[];let current:typeof components=[];
 for(const item of components){if(Buffer.byteLength(JSON.stringify([...current,item]))>110*1024){if(!current.length)throw Error('Native review component cannot fit');groups.push(current);current=[];}current.push(item);}if(current.length)groups.push(current);
 return groups.map((sources,index)=>{const text='# Exact executed native SDK components\n\nComplete fixed handlers, provider methods and result/content functions from the compiled entry; each has exact entry hash, offsets and content hash. Unrelated tools and bundled MSAL/MCP libraries are not reproduced.\n\n'+JSON.stringify({schemaVersion:1,entrySha256:expected,sources});return {file:`docs/STANDALONE-NATIVE-SOURCES-${index+1}.md`,sha256:sha(text),text};});
}
