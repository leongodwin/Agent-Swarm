import {afterEach,expect,it,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startBrowserBridge} from './browserBridge.ts';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
const cleanups:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const clean of cleanups.splice(0).reverse())await clean();});
async function fixture(clock?:()=>number,name:string|string[]='synthetic_browser_action'){
 const tools=(Array.isArray(name)?name:[name]).map(name=>({name,description:'Synthetic native contract',inputSchema:{type:'object' as const,properties:{},additionalProperties:true}})),tool=tools[0];
 const callTool=vi.fn(async()=>({content:[{type:'text' as const,text:'Synthetic authenticated page; no real browser'}]})),close=vi.fn(async()=>{}),listTools=vi.fn(async()=>({tools}));
 const bridge=await startBrowserBridge({listTools,callTool,close},0,clock);cleanups.push(()=>bridge.close());
 const client=async()=>{const transport=new StreamableHTTPClientTransport(new URL(bridge.endpoint)),client=new Client({name:'synthetic-worker',version:'1'});await client.connect(transport);cleanups.push(async()=>{await transport.terminateSession().catch(()=>{});await client.close();});return{client,transport};};
 return{bridge,tool,callTool,close,listTools,client};
}
it('retains one upstream and hands exclusive browser ownership between genuine MCP client sessions',async()=>{
 const f=await fixture(),a=await f.client(),b=await f.client();
 expect((await a.client.listTools()).tools).toEqual([f.tool]);expect((await b.client.listTools()).tools).toEqual([f.tool]);
 expect(await a.client.callTool({name:'synthetic_browser_action',arguments:{}})).toEqual(await f.callTool.mock.results[0].value);
 const busy=await b.client.callTool({name:'synthetic_browser_action',arguments:{}});expect(busy.isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
 await a.transport.terminateSession();await a.client.close();
 expect((await b.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).not.toBe(true);expect(f.callTool).toHaveBeenCalledTimes(2);expect(f.close).not.toHaveBeenCalled();
 await f.bridge.close();expect(f.close).toHaveBeenCalledOnce();
});
it('rejects cross-origin, wrong-host and non-MCP requests before native calls',async()=>{
 const f=await fixture();for(const headers of [{Origin:'https://untrusted.test'},{Host:'evil.test'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[]){
  const status=await new Promise<number|undefined>((resolve,reject)=>{const req=http.request(f.bridge.endpoint,{method:'POST',headers},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});expect(status).toBe(403);
 }
 expect((await fetch(f.bridge.endpoint+'/other')).status).toBe(404);expect(f.callTool).not.toHaveBeenCalled();
});
it('quarantines an uncertain native outcome instead of handing it to another session',async()=>{
 const f=await fixture(),a=await f.client(),b=await f.client();f.callTool.mockRejectedValueOnce(Error('Upstream disconnected after dispatch'));
 await a.client.callTool({name:'synthetic_browser_action',arguments:{}}).catch(()=>{});await a.transport.terminateSession();
 expect((await b.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
});
it('quarantines a fulfilled native MCP error before allowing another worker to acquire the browser',async()=>{
 const f=await fixture(),a=await f.client(),b=await f.client();f.callTool.mockResolvedValueOnce({isError:true,content:[{type:'text',text:'Navigation timed out after an uncertain action'}]} as never);
 expect((await a.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).toBe(true);await a.transport.terminateSession();
 expect((await b.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
});
it('the actual stdio proxy releases its lease on client shutdown without closing the approved upstream',async()=>{
 const f=await fixture(),proxy=new Client({name:'synthetic-native-worker',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./browserProxy.mjs',import.meta.url)),f.bridge.endpoint],stderr:'ignore'});
 await proxy.connect(transport);expect((await proxy.listTools()).tools).toEqual([f.tool]);await proxy.callTool({name:'synthetic_browser_action',arguments:{}});await proxy.close();
 const next=await f.client();await vi.waitFor(async()=>expect((await next.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).not.toBe(true));expect(f.close).not.toHaveBeenCalled();
});
it('reclaims expired abandoned metadata-only sessions without another upstream connection or browser action',async()=>{
 let now=1000;const f=await fixture(()=>now);
 for(let i=0;i<8;i++){const a=await f.client();await a.client.listTools();await a.client.close();}
 const status=()=>fetch(f.bridge.endpoint.replace('/mcp','/status')).then(r=>r.json());
 expect(await status()).toMatchObject({sessions:8,metadataOnly:8,owned:false,inFlight:0,quarantined:false});
 await expect(f.client()).rejects.toMatchObject({code:503});expect(f.callTool).not.toHaveBeenCalled();
 now+=120000;const next=await f.client();expect((await next.client.listTools()).tools).toEqual([f.tool]);
 expect(await status()).toMatchObject({sessions:1,metadataOnly:1,owned:false});expect(f.listTools).toHaveBeenCalledOnce();expect(f.close).not.toHaveBeenCalled();expect(f.callTool).not.toHaveBeenCalled();
});
it('never expires a session that dispatched a browser action or clears an uncertain outcome with time',async()=>{
 let now=1000;const f=await fixture(()=>now),owner=await f.client();await owner.client.callTool({name:'synthetic_browser_action',arguments:{}});
 now+=120001;
 const next=await f.client();expect((await next.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
 await owner.transport.terminateSession();f.callTool.mockRejectedValueOnce(Error('Uncertain native result'));await next.client.callTool({name:'synthetic_browser_action',arguments:{}}).catch(()=>{});await next.transport.terminateSession();now+=120001;
 const last=await f.client();expect((await last.client.callTool({name:'synthetic_browser_action',arguments:{}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledTimes(2);
});
it('does not reclaim metadata on backwards time and reports capacity without exposing session identities',async()=>{
 let now=200000;const f=await fixture(()=>now);for(let i=0;i<8;i++)await (await f.client()).client.close();now=0;
 await expect(f.client()).rejects.toMatchObject({code:503});const response=await fetch(f.bridge.endpoint.replace('/mcp','/status')),status=await response.json();
 expect(status).toEqual({sessions:8,metadataOnly:8,owned:false,inFlight:0,quarantined:false});expect(response.headers.get('cache-control')).toBe('no-store');expect(f.callTool).not.toHaveBeenCalled();
});
it('keeps simultaneous initialize requests within the session bound',async()=>{
 const f=await fixture();const results=await Promise.allSettled(Array.from({length:16},()=>f.client()));
 const count=results.filter(r=>r.status==='fulfilled').length;expect(count).toBeGreaterThan(0);expect(count).toBeLessThanOrEqual(8);
 const status=await fetch(f.bridge.endpoint.replace('/mcp','/status')).then(r=>r.json());expect(status.sessions).toBe(count);expect(f.callTool).not.toHaveBeenCalled();
});
it.each(['throw','error-result'])('permits a new connection attempt after an exact tab-inventory %s without clearing write uncertainty',async mode=>{
 const f=await fixture(undefined,'browser_tabs'),first=await f.client();
 if(mode==='throw')f.callTool.mockRejectedValueOnce(Error('Extension not connected'));else f.callTool.mockResolvedValueOnce({isError:true,content:[{type:'text',text:'Extension not connected'}]} as never);
 await first.client.callTool({name:'browser_tabs',arguments:{action:'list'}}).catch(()=>{});await first.transport.terminateSession();
 const next=await f.client();expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).not.toBe(true);expect(f.callTool).toHaveBeenCalledTimes(2);
});
it.each([{action:'new'},{action:'select',index:0},{action:'list',url:'https://untrusted.test'}])('retains quarantine for every non-inventory tab command: %j',async args=>{
 const f=await fixture(undefined,'browser_tabs'),first=await f.client();f.callTool.mockRejectedValueOnce(Error('Unknown dispatched result'));
 await first.client.callTool({name:'browser_tabs',arguments:args}).catch(()=>{});await first.transport.terminateSession();const next=await f.client();expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
});
it.each([true,false])('handles client disconnect during pending inventory=%s without overlapping native calls or clearing write uncertainty',async inventory=>{
 const name=inventory?'browser_tabs':'synthetic_browser_action',f=await fixture(undefined,name),first=await f.client();let finish!:(value:Awaited<ReturnType<typeof f.callTool>>)=>void;
 f.callTool.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=first.client.callTool({name,arguments:inventory?{action:'list'}:{}}).catch(()=>{});
 await vi.waitFor(()=>expect(f.callTool).toHaveBeenCalledOnce());await first.transport.terminateSession();await first.client.close();
 const status=await fetch(f.bridge.endpoint.replace('/mcp','/status')).then(r=>r.json());expect(status).toMatchObject({inFlight:1,quarantined:!inventory});
 const next=await f.client(),following=next.client.callTool({name,arguments:inventory?{action:'list'}:{}});
 await new Promise(resolve=>setTimeout(resolve,20));expect(f.callTool).toHaveBeenCalledOnce();
 finish({content:[{type:'text',text:'Completed synthetic read'}]});await pending;
 expect((await following).isError).toBe(inventory?undefined:true);expect(f.callTool).toHaveBeenCalledTimes(inventory?2:1);
});
it.each(['throw','error-result'])('allows exact inline snapshot read recovery after %s, retaining action quarantine',async mode=>{
 const f=await fixture(undefined,'browser_snapshot'),first=await f.client();
 if(mode==='throw')f.callTool.mockRejectedValueOnce(Error('Snapshot timed out'));else f.callTool.mockResolvedValueOnce({isError:true,content:[{type:'text',text:'Snapshot timed out'}]} as never);
 await first.client.callTool({name:'browser_snapshot',arguments:{}}).catch(()=>{});await first.transport.terminateSession();
 const next=await f.client();expect((await next.client.callTool({name:'browser_snapshot',arguments:{}})).isError).not.toBe(true);expect(f.callTool).toHaveBeenCalledTimes(2);
});
it.each([{filename:'synthetic.json'},{unexpected:true}])('does not exempt nonempty snapshot arguments: %j',async args=>{
 const f=await fixture(undefined,'browser_snapshot'),first=await f.client();f.callTool.mockRejectedValueOnce(Error('Uncertain non-inline outcome'));await first.client.callTool({name:'browser_snapshot',arguments:args}).catch(()=>{});await first.transport.terminateSession();
 const next=await f.client();expect((await next.client.callTool({name:'browser_snapshot',arguments:{}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
});
it('serializes a new client behind a pending inline snapshot after the first client disconnects',async()=>{
 const f=await fixture(undefined,'browser_snapshot'),first=await f.client();let finish!:(value:Awaited<ReturnType<typeof f.callTool>>)=>void;f.callTool.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=first.client.callTool({name:'browser_snapshot',arguments:{}}).catch(()=>{});await vi.waitFor(()=>expect(f.callTool).toHaveBeenCalledOnce());await first.transport.terminateSession();await first.client.close();
 const next=await f.client(),following=next.client.callTool({name:'browser_snapshot',arguments:{}});await new Promise(resolve=>setTimeout(resolve,20));expect(f.callTool).toHaveBeenCalledOnce();
 finish({content:[{type:'text',text:'Synthetic inline read completed'}]});await pending;expect((await following).isError).not.toBe(true);expect(f.callTool).toHaveBeenCalledTimes(2);
});

it('fences an abandoned exclusively-read-only session at the exact idle boundary and retains hashed handoff evidence',async()=>{
 let now=1000;const f=await fixture(()=>now,'browser_tabs'),old=await f.client();await old.client.callTool({name:'browser_tabs',arguments:{action:'list'}});const id=old.transport.sessionId!;await old.client.close();
 const next=await f.client();now+=119999;expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);
 now++;const result=await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}});expect(result.isError).not.toBe(true);expect(result._meta?.cubefarmReadOnlyHandoff).toMatchObject({kind:'fenced-idle-read-only-session',completedCalls:1,idleMs:120000});expect(JSON.stringify(result._meta)).not.toContain(id);
 const stale=await fetch(f.bridge.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Mcp-Session-Id':id},body:'{}'});expect(stale.status).toBe(404);expect(f.callTool).toHaveBeenCalledTimes(2);
 await old.transport.terminateSession().catch(()=>{});const third=await f.client();expect((await third.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);
});
it.each([NaN,-100,120999])('does not recover a read-only owner at invalid/insufficient monotonic time %s',async at=>{
 let now=1000;const f=await fixture(()=>now,'browser_tabs'),old=await f.client();await old.client.callTool({name:'browser_tabs',arguments:{action:'list'}});const next=await f.client();now=at;
 expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
 now=999999;expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(at===120999?undefined:true);
});
it('only a fresh exact inventory can recover an idle read session; any unsafe admission prevents later recovery',async()=>{
 let now=1000;const f=await fixture(()=>now,['browser_tabs','browser_snapshot']),old=await f.client();await old.client.callTool({name:'browser_snapshot',arguments:{}});now+=120000;const next=await f.client();
 for(const request of [{name:'browser_snapshot',arguments:{}},{name:'browser_tabs',arguments:{action:'new'}},{name:'browser_tabs',arguments:{action:'list',index:0}}])expect((await next.client.callTool(request)).isError).toBe(true);
 expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).not.toBe(true);
 await next.client.callTool({name:'browser_tabs',arguments:{action:'select',index:0}});now+=999999;const last=await f.client();expect((await last.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);
});
it('times idle from the last completed read, never admission, and blocks while another read is queued',async()=>{
 let now=1000;const f=await fixture(()=>now,'browser_tabs'),old=await f.client();const finish:Array<(value:any)=>void>=[];f.callTool.mockImplementation(()=>new Promise(resolve=>finish.push(resolve)));
 const a=old.client.callTool({name:'browser_tabs',arguments:{action:'list'}}),b=old.client.callTool({name:'browser_tabs',arguments:{action:'list'}});await vi.waitFor(()=>expect(f.callTool).toHaveBeenCalledOnce());now+=500000;const next=await f.client();expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);
 finish[0]({content:[]});await a;await vi.waitFor(()=>expect(f.callTool).toHaveBeenCalledTimes(2));expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);finish[1]({content:[]});await b;
 f.callTool.mockResolvedValue({content:[]});expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);now+=120000;expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).not.toBe(true);
});
it('fences exactly one competing inventory and does not resurrect a revoked owner on replacement read errors',async()=>{
 let now=1000;const f=await fixture(()=>now,'browser_tabs'),old=await f.client();await old.client.callTool({name:'browser_tabs',arguments:{action:'list'}});now+=120000;const a=await f.client(),b=await f.client();
 f.callTool.mockResolvedValueOnce({isError:true,content:[{type:'text',text:'Synthetic read failure'}]} as never);const results=await Promise.all([a.client.callTool({name:'browser_tabs',arguments:{action:'list'}}),b.client.callTool({name:'browser_tabs',arguments:{action:'list'}})]);
 expect(results.filter(r=>r._meta?.cubefarmReadOnlyHandoff)).toHaveLength(1);expect(f.callTool).toHaveBeenCalledTimes(2);await expect(old.client.callTool({name:'browser_tabs',arguments:{action:'new'}})).rejects.toThrow();expect(f.callTool).toHaveBeenCalledTimes(2);
});
it('permanently disallows timed recovery after an unsafe queued call is cancelled before native dispatch',async()=>{
 let now=1000;const f=await fixture(()=>now,'browser_tabs'),old=await f.client();let finish!:(value:any)=>void;f.callTool.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const read=old.client.callTool({name:'browser_tabs',arguments:{action:'list'}});await vi.waitFor(()=>expect(f.callTool).toHaveBeenCalledOnce());const aborter=new AbortController(),unsafe=old.client.callTool({name:'browser_tabs',arguments:{action:'new'}},undefined,{signal:aborter.signal}).catch(()=>{});
 await new Promise(resolve=>setTimeout(resolve,30));aborter.abort();await unsafe;await new Promise(resolve=>setTimeout(resolve,30));finish({content:[]});await read;await new Promise(resolve=>setTimeout(resolve,30));now+=999999;
 const next=await f.client();expect((await next.client.callTool({name:'browser_tabs',arguments:{action:'list'}})).isError).toBe(true);expect(f.callTool).toHaveBeenCalledOnce();
});
