import {verificationNavigationUrl,verificationScenario,type BrowserVerificationContext} from './browserVerificationContext.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {browserBridgeEndpoint} from './browserTools.ts';
import {acceptanceScope,type ReleasePlan} from './releasePlan.ts';
const require=createRequire(import.meta.url);
export function bridgeScenarioCode(data:unknown){return `async(page)=>{
 const d=${JSON.stringify(data)},origin=new URL(d.baseUrl).origin;
 const target=async()=>{if(new URL(page.url()).origin!==origin)throw Error('Left approved app origin');if(!d.frame)return page;const e=await page.locator(d.frame.selector).elementHandle();const f=await e?.contentFrame();if(!f||new URL(f.url()).origin!==d.frame.origin.replace(/\\/$/,''))throw Error('Frame origin differs');return f;};
 const ready=()=>({nonce:d.nonce,phase:d.phase,passed:true});
 if(d.phase==='begin'){
  await page.setViewportSize(d.viewport);page.setDefaultTimeout(d.timeout);page.setDefaultNavigationTimeout(d.timeout);
  await page.context().tracing.start({screenshots:true,snapshots:true});
  const state={errors:[],listener:null};state.listener=e=>state.errors.push(e.message);page.__cubeFarmVerification=state;page.on('pageerror',state.listener);
  if(d.first)await page.goto(d.baseUrl);return ready();
 }
 if(d.phase==='guard'){
  const surface=await target();await surface.locator(d.identity.userSelector).filter({hasText:d.identity.expectedUser}).waitFor({state:'visible',timeout:d.timeout});return {...ready(),frameUrl:surface.url()};
 }
 if(d.phase==='step'){
  if(new URL(page.url()).origin!==origin)throw Error('Left approved app origin');
  const frames=d.frame?page.frames().filter(f=>f.url()===d.frameUrl&&new URL(f.url()).origin===d.frame.origin.replace(/\\/$/,'')):[];
  if(d.frame&&frames.length!==1)throw Error('Approved frame changed');const surface=d.frame?frames[0]:page,s=d.step;
  // Exactly one action per dispatch. No awaited guard can resume into a later action.
  if(s.action==='goto'){const u=new URL(s.path,d.baseUrl);if(u.origin!==origin)throw Error('Navigation left approved origin');await page.goto(u.href,{timeout:d.timeout});}
  else if(s.action==='click')await surface.locator(s.selector).click({timeout:d.timeout});
  else if(s.action==='fill')await surface.locator(s.selector).fill(s.value,{timeout:d.timeout});
  else if(s.action==='reload')await page.reload({timeout:d.timeout});
  else if(s.action==='press')await surface.locator(s.selector).press(s.key,{timeout:d.timeout});
  else if(s.action==='text')await surface.locator(s.selector).filter({hasText:s.contains}).first().waitFor({state:'visible',timeout:d.timeout});
  else throw Error('Unsupported connected-browser action');return ready();
 }
 if(d.phase!=='finish')throw Error('Unknown verification phase');
 const label=(await target()).locator(d.identity.userSelector).filter({hasText:d.identity.expectedUser});await label.waitFor({state:'visible',timeout:d.timeout});const observedUser=await label.innerText();
 const state=page.__cubeFarmVerification;if(!state)throw Error('Verification session missing');if(state.errors.length)throw Error('Browser error: '+state.errors[0]);
 const surfaces=d.frame?[page,await target()]:[page],violations=[];
 for(const surface of surfaces){await surface.addScriptTag({path:d.axeFile});const a=await surface.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));violations.push(...a.violations);if(await surface.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');}
 if(violations.some(v=>['serious','critical'].includes(v.impact)))throw Error('Accessibility gate failed');
 await page.screenshot({path:d.screenshot,fullPage:true});await page.context().tracing.stop({path:d.trace});page.off('pageerror',state.listener);delete page.__cubeFarmVerification;
 return {nonce:d.nonce,passed:true,durationMs:d.durationMs,observedUser,accessibility:{violations}};
}`;}
function nativeBody(raw:unknown){
 const result=z.object({isError:z.boolean().optional(),content:z.array(z.object({type:z.literal('text'),text:z.string()})).length(1)}).parse(raw);
 if(result.isError)throw Error('Native connected-browser verification failed; preserve the quarantined session');
 const text=result.content[0].text;if(Buffer.byteLength(text)>2*1024*1024||!text.startsWith('### Result\n'))throw Error('Unexpected native browser result');
 const end=text.indexOf('\n### ',11);return parseUnambiguousJson(text.slice(11,end===-1?undefined:end).trim(),{maxBytes:2*1024*1024});
}
/** Dispatch boundaries prevent later actions after interruption; an in-flight
 * cancelled native action remains ambiguous and the bridge quarantines it. */
export async function runBridgeScenario(data:Record<string,any>,call:(code:string,timeout:number)=>Promise<unknown>,signal:AbortSignal,now=Date.now){
 const started=now(),deadline=started+data.budget;
 const dispatch=async(phase:string,extra:Record<string,unknown>={})=>{
  signal.throwIfAborted();const remaining=deadline-now();if(remaining<=0)throw Error('Usability time limit exceeded');
  const raw=await call(bridgeScenarioCode({...data,...extra,phase,timeout:Math.min(15000,remaining)}),Math.min(120000,remaining));
  signal.throwIfAborted();if(now()>deadline)throw Error('Usability time limit exceeded');return raw;
 };
 const phaseResult=(raw:unknown,phase:string)=>z.object({nonce:z.literal(data.nonce),phase:z.literal(phase),passed:z.literal(true),frameUrl:z.string().optional()}).parse(nativeBody(raw));
 phaseResult(await dispatch('begin'),'begin');
 for(const step of data.scenario.steps){const guard=phaseResult(await dispatch('guard'),'guard');phaseResult(await dispatch('step',{step,frameUrl:guard.frameUrl}),'step');}
 return bridgeVerificationResult(await dispatch('finish',{durationMs:now()-started}),data.nonce);
}
export function bridgeVerificationResult(raw:unknown,nonce:string){
 return z.object({nonce:z.literal(nonce),passed:z.literal(true),durationMs:z.number().nonnegative(),observedUser:z.string(),accessibility:z.object({violations:z.array(z.object({impact:z.enum(['minor','moderate','serious','critical']).nullable()}).passthrough()).refine(rows=>!rows.some(row=>['serious','critical'].includes(row.impact??'')),'Accessibility gate failed')})}).parse(nativeBody(raw));
}
export async function verifyConnectedBrowser(plan:ReleasePlan,evidence:string,signal:AbortSignal,endpoint=browserBridgeEndpoint(),execution?:BrowserVerificationContext){
 if(!endpoint)throw Error('Connect the approved local browser bridge before deployment');
 for(const name of ['independent-verification.json','independent-failure.json']){await fs.lstat(path.join(evidence,name)).then(()=>{throw Error('Independent report already exists; retain before retry');},error=>{if(error.code!=='ENOENT')throw error;});}
 const client=new Client({name:'CubeFarm-independent-delivery-verifier',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(endpoint)),files:string[]=[],results:unknown[]=[];
 try{
  signal.throwIfAborted();await client.connect(transport,{signal,timeout:15000});
  const tools=await client.listTools(undefined,{signal}),tool=tools.tools.find(t=>t.name==='browser_run_code_unsafe');
  if(!tool||!z.object({properties:z.object({code:z.object({type:z.literal('string')})})}).safeParse(tool.inputSchema).success)throw Error('Installed native browser verification contract differs');
  const axeFile=require.resolve('axe-core/axe.min.js');let index=0;
  for(const identity of plan.verification.identities)for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   let first=true;
   for(const scenario of plan.verification.scenarios.filter(s=>s.identity===identity.id)){
    signal.throwIfAborted();const prefix=`independent-${identity.id}-${viewport.width}-${index++}`,nonce=crypto.randomUUID(),screenshot=prefix+'.png',trace=prefix+'.zip',accessibility=prefix+'-accessibility.json';
    for(const file of [screenshot,trace,accessibility]){const exists=await fs.lstat(path.join(evidence,file)).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;});if(exists)throw Error('Independent browser evidence already exists; retain before retry');}
    const beforeStart=Date.now();await execution?.scenarioStarted?.(scenario.name,viewport.width);signal.throwIfAborted();const startDuration=Date.now()-beforeStart;
    const result=await runBridgeScenario({baseUrl:verificationNavigationUrl(plan,execution),frame:plan.verification.frame,identity,scenario:verificationScenario(plan,execution,scenario),viewport,budget:plan.quality.maxTaskDurationMs-startDuration,first,axeFile,nonce,screenshot:path.join(evidence,screenshot),trace:path.join(evidence,trace)},(code,timeout)=>client.callTool({name:'browser_run_code_unsafe',arguments:{code}},undefined,{signal,timeout}),signal);result.durationMs+=startDuration;if(!result.observedUser.includes(identity.expectedUser)||result.durationMs>plan.quality.maxTaskDurationMs)throw Error('Native identity or task duration differs');
    for(const file of [screenshot,trace]){const stat=await fs.lstat(path.join(evidence,file));if(!stat.isFile()||stat.isSymbolicLink()||!stat.size)throw Error('Native screenshot or trace unavailable');}
    await fs.writeFile(path.join(evidence,accessibility),JSON.stringify(result.accessibility),{flag:'wx'});files.push(screenshot,trace,accessibility);first=false;
    await execution?.scenarioCompleted?.(scenario.name,viewport.width);
    results.push({name:scenario.name,category:scenario.category,criterion:scenario.criterion,states:scenario.states,durationMs:result.durationMs,accessibility,identity:identity.id,expectedUser:identity.expectedUser,observedUser:result.observedUser,method:plan.verification.frame?'browser-frame':'browser-dom',transport:'approved-native-mcp-bridge',uploads:[],viewport,passed:true,screenshot});
   }
  }
  await fs.writeFile(path.join(evidence,'independent-verification.json'),JSON.stringify({schemaVersion:1,acceptance:acceptanceScope(plan),applicationUrl:plan.verification.baseUrl,completedAt:new Date().toISOString(),results}),{flag:'wx'});return ['independent-verification.json',...files];
 }catch(error){await fs.writeFile(path.join(evidence,'independent-failure.json'),JSON.stringify({failedAt:new Date().toISOString(),error:(error as Error).message,completedScenarios:results}),{flag:'wx'}).catch(writeError=>{if(writeError.code!=='EEXIST')throw writeError;});throw error;}
 finally{await transport.terminateSession().catch(()=>{});await client.close();}
}
