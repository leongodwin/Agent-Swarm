import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {afterEach,expect,it,vi} from 'vitest';
import {startBrowserBridge} from './browserBridge.ts';
import {verifyConnectedBrowser,bridgeVerificationResult,bridgeScenarioCode,runBridgeScenario} from './bridgeVerification.ts';
import {releasePlanSchema} from './releasePlan.ts';
const cleanups:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
function plan(){return {acceptanceProfile:'functional-development',name:'Synthetic connected app',owner:'author',qaOwner:'reviewer',requiredIssues:[1],components:['app'],acceptanceCriteria:['Synthetic state is visible'],quality:{maxTaskDurationMs:30000,maxSeriousAccessibilityIssues:0},monitoring:{intervalMinutes:15,criticalProbeIds:['app']},verification:{browserSession:'connected-extension',baseUrl:'https://verification.test/',identities:[{id:'maker',expectedUser:'maker@example.test',userSelector:'#user'}],scenarios:['loading','empty','validation','failure','recovery','success'].map((state,i)=>({name:state,states:[state],category:['journey','journey','error-handling','authorization','persistence','journey'][i],identity:'maker',criterion:0,steps:[{action:'press',selector:'#result',key:'Tab'},...(i===4?[{action:'reload'}]:[]),{action:'text',selector:'#result',contains:'Verified synthetic page'}]}))}};}
it('executes the immutable QA plan through genuine MCP sessions against a real synthetic browser, without stored sign-in files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-verification-'));cleanups.push(()=>fs.rm(root,{recursive:true,force:true}));
 const browser=await chromium.launch({headless:true});cleanups.push(()=>browser.close());const context=await browser.newContext(),page=await context.newPage();
 await context.route('https://verification.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Synthetic verification fixture</title></head><body><main><h1>Verification</h1><p id="user">maker@example.test</p><p id="result">Verified synthetic page</p></main></body></html>'}));
 const callTool=vi.fn(async(input:{name:string;arguments?:Record<string,unknown>})=>{expect(input.name).toBe('browser_run_code_unsafe');const result=await new Function('return ('+String(input.arguments?.code)+')')()(page);return {content:[{type:'text' as const,text:'### Result\n'+JSON.stringify(result)+'\n### Ran Playwright code\nOffice-owned synthetic test code'}]};});
 const bridge=await startBrowserBridge({listTools:async()=>({tools:[{name:'browser_run_code_unsafe',inputSchema:{type:'object',properties:{code:{type:'string'}}}}]}),callTool,close:async()=>{}},0);cleanups.push(()=>bridge.close());
 const lifecycle:string[]=[];
 const files=await verifyConnectedBrowser(releasePlanSchema.parse(plan()),root,new AbortController().signal,bridge.endpoint,{runId:crypto.randomUUID(),scenarioStarted:async(name,width)=>{lifecycle.push(`start:${name}:${width}`);},scenarioCompleted:async(name,width)=>{lifecycle.push(`end:${name}:${width}`);}});
 const report=JSON.parse(await fs.readFile(path.join(root,'independent-verification.json'),'utf8'));expect(report.results).toHaveLength(12);expect(new Set(report.results.map((r:any)=>r.viewport.width))).toEqual(new Set([390,1440]));expect(report.results.every((r:any)=>r.observedUser==='maker@example.test'&&r.passed)).toBe(true);
 expect(callTool.mock.calls.length).toBeGreaterThan(12);for(const file of files)expect((await fs.stat(path.join(root,file))).size).toBeGreaterThan(0);expect((await fs.readdir(root)).some(name=>name.includes('delivery-identities'))).toBe(false);
 expect(lifecycle).toHaveLength(24);for(let i=0;i<lifecycle.length;i+=2)expect(lifecycle[i+1]).toBe(lifecycle[i].replace('start:','end:'));
},60000);
it.each(['nonce','error','critical','missing-impact','descriptor'] as const)('rejects %s as a native verification success',mode=>{
 const value:any={nonce:'expected',passed:true,durationMs:2,observedUser:'maker@example.test',accessibility:{violations:[]}};
 if(mode==='nonce')value.nonce='other';if(mode==='critical')value.accessibility.violations=[{impact:'critical'}];if(mode==='missing-impact')value.accessibility.violations=[{}];
 const raw={isError:mode==='error',content:[{type:'text',text:mode==='descriptor'?'Tool exists':'### Result\n'+JSON.stringify(value)+'\n### Ran Playwright code\n...'}]};expect(()=>bridgeVerificationResult(raw,'expected')).toThrow();
});
it('does not enable connected sessions for production, multiple users or unsupported uploads',()=>{
 expect(releasePlanSchema.safeParse(plan()).success).toBe(true);
 expect(releasePlanSchema.safeParse({...plan(),acceptanceProfile:'production'}).success).toBe(false);
 const multiple=plan();multiple.verification.identities.push({id:'other',expectedUser:'other@example.test',userSelector:'#user'});expect(releasePlanSchema.safeParse(multiple).success).toBe(false);
 const upload=plan() as any;upload.verification.scenarios[0].steps=[{action:'upload',selector:'#file',fixture:'data.txt',sha256:'a'.repeat(64)}];expect(releasePlanSchema.safeParse(upload).success).toBe(false);
});
it('encodes untrusted selectors and values as data in the generated office interpreter',()=>{
 const injection='\"}); globalThis.UNTRUSTED_EXECUTED=true; //';
 const source=bridgeScenarioCode({scenario:{steps:[{action:'fill',selector:'#value',value:injection}]}});expect(()=>new Function('return ('+source+')')).not.toThrow();expect(source).toContain(JSON.stringify(injection));
});


function native(value:unknown){return {content:[{type:'text',text:'### Result\n'+JSON.stringify(value)+'\n### Ran Playwright code\nfixture'}]};}
it.each(['abort','deadline'] as const)('dispatches no later browser action after %s between steps',async mode=>{
 const browser=await chromium.launch({headless:true});cleanups.push(()=>browser.close());const context=await browser.newContext(),page=await context.newPage();
 await context.route('https://verification.test/**',route=>route.fulfill({contentType:'text/html',body:'<p id="user">maker@example.test</p><button id="act" onclick="this.dataset.count=Number(this.dataset.count||0)+1">Act</button>'}));
 // The injected clock controls expiry; real Chromium setup still needs an ordinary action budget.
 const controller=new AbortController();let clock=100,actions=0;
 const call=async(code:string)=>{const result=await new Function('return ('+code+')')()(page);if(result.phase==='step'){actions++;if(mode==='abort')controller.abort();else clock=10101;}return native(result);};
 await expect(runBridgeScenario({baseUrl:'https://verification.test/',identity:{userSelector:'#user',expectedUser:'maker@example.test'},viewport:{width:600,height:600},budget:10000,first:true,nonce:'n',scenario:{steps:[{action:'click',selector:'#act'},{action:'click',selector:'#act'}]}},call,controller.signal,()=>clock)).rejects.toThrow();
 expect(actions).toBe(1);expect(await page.locator('#act').getAttribute('data-count')).toBe('1');
});
it.each(['independent-verification.json','independent-failure.json'])('retains existing %s without connecting or overwriting it',async name=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-retain-'));cleanups.push(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,name),'retained evidence');
 await expect(verifyConnectedBrowser(releasePlanSchema.parse(plan()),root,new AbortController().signal,'http://127.0.0.1:1/mcp')).rejects.toThrow('already exists');
 expect(await fs.readFile(path.join(root,name),'utf8')).toBe('retained evidence');expect(await fs.readdir(root)).toEqual([name]);
});
