import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({connect:vi.fn(),list:vi.fn(),call:vi.fn(),clientClose:vi.fn(),transportClose:vi.fn(),transport:null as null|{onclose?:()=>void;close():Promise<void>}}));
vi.mock('./skillRegistry.ts',()=>({discoverSkills:()=>({skills:[]})}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js',()=>({StdioClientTransport:class{onclose?:()=>void;closed=false;constructor(){state.transport=this;}async close(){await state.transportClose();if(!this.closed){this.closed=true;this.onclose?.();}}}}));
vi.mock('@modelcontextprotocol/sdk/client/index.js',()=>({Client:class{getServerVersion(){return{name:'synthetic-flowagent',version:'1.0.0'};}connect(...args:unknown[]){return state.connect(...args);}listTools(...args:unknown[]){return state.list(...args);}callTool(...args:unknown[]){return state.call(...args);}async close(){await state.clientClose();await state.transport?.close();}}}));
import {connectFlowAdapter} from './flowAdapter.ts';
const names=['whoami','get_flow','get_flow_context','preflight_flow','publish_flow','disable_flow','get_run_history','get_run_details','get_run_actions','get_run_action_content'];
const roots:string[]=[];
it.each([{isError:true,content:[{type:'text',text:'private diagnostic'}]},{content:[{type:'text',text:'{"success":false,"detail":"private diagnostic"}'}]}])('captures original failed native wrapper before throwing a content-free error',async response=>{const f=await fixture(),capture=vi.fn(async()=>{});state.call.mockResolvedValue(response);const adapter=await connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:async()=>{},captureNativeFailure:capture});await expect(adapter.call('get_flow',{})).rejects.toThrow(/failed|blocked/);expect(capture).toHaveBeenCalledExactlyOnceWith('get_flow',response);expect(state.call).toHaveBeenCalledOnce();await adapter.close();});
it('holds a native failure when protected capture refuses admission, without a second provider request',async()=>{const f=await fixture(),capture=vi.fn(async()=>{throw Error('Protected capture unavailable');});state.call.mockResolvedValue({isError:true,content:[{type:'text',text:'private diagnostic'}]});const adapter=await connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:async()=>{},captureNativeFailure:capture});await expect(adapter.call('get_flow',{})).rejects.toThrow('Protected capture unavailable');expect(state.call).toHaveBeenCalledOnce();await adapter.close();});
afterEach(async()=>{vi.unstubAllEnvs();vi.resetAllMocks();state.transport=null;await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true,maxRetries:5})));});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-flow-connect-'));roots.push(root);const entry=path.join(root,'synthetic.mjs');await fs.writeFile(entry,'// never executed: mocked transport');vi.stubEnv('SWARM_FLOWAGENT_ENTRY',entry);state.connect.mockResolvedValue(undefined);state.list.mockResolvedValue({tools:names.map(name=>({name}))});state.call.mockResolvedValue({content:[{type:'text',text:'{"observed":true}'}]});state.clientClose.mockResolvedValue(undefined);state.transportClose.mockResolvedValue(undefined);const controller=new AbortController();return {root,controller,connect:()=>connectFlowAdapter(root,controller.signal)};}
it('requires exact run detail capability before admitting a flow runtime',async()=>{
  const f=await fixture();state.list.mockResolvedValue({tools:names.filter(name=>name!=='get_run_details').map(name=>({name}))});
  await expect(f.connect()).rejects.toThrow('get_run_details is missing');expect(state.call).not.toHaveBeenCalled();expect(state.clientClose).toHaveBeenCalledOnce();
});
it('requires native action status observation before admitting the functional failure verifier',async()=>{const f=await fixture();state.list.mockResolvedValue({tools:names.filter(name=>name!=='get_run_actions').map(name=>({name}))});await expect(f.connect()).rejects.toThrow('get_run_actions is missing');expect(state.call).not.toHaveBeenCalled();expect(state.clientClose).toHaveBeenCalledOnce();});
it('discovers paged required capabilities and refuses calls after joined cleanup',async()=>{
  const f=await fixture();state.list.mockResolvedValueOnce({tools:names.slice(0,4).map(name=>({name})),nextCursor:'page-2'}).mockResolvedValueOnce({tools:names.slice(4).map(name=>({name}))});const adapter=await f.connect();expect(await adapter.call('get_flow',{})).toEqual({observed:true});expect(state.list.mock.calls[1][0]).toEqual({cursor:'page-2'});await Promise.all([adapter.close(),adapter.close()]);expect(state.clientClose).toHaveBeenCalledOnce();await expect(adapter.call('get_flow',{})).rejects.toThrow('closed');expect(state.call).toHaveBeenCalledOnce();
});
it.each(['missing','repeated','limit'] as const)('denies incomplete capability discovery and closes its runtime: %s',async mode=>{
  const f=await fixture();if(mode==='missing')state.list.mockResolvedValue({tools:names.slice(1).map(name=>({name}))});if(mode==='repeated')state.list.mockResolvedValue({tools:[],nextCursor:'same'});if(mode==='limit'){let page=0;state.list.mockImplementation(async()=>({tools:[],nextCursor:String(++page)}));}
  await expect(f.connect()).rejects.toThrow(mode==='missing'?'missing':mode==='repeated'?'repeated cursor':'pagination limit');expect(state.clientClose).toHaveBeenCalledOnce();expect(state.transportClose).toHaveBeenCalled();expect(state.list.mock.calls.length).toBe(mode==='repeated'?2:mode==='limit'?20:1);
});
it('denies a late discovery page after cancellation even if the provider ignores its signal',async()=>{
  const f=await fixture();let finish!:(value:unknown)=>void;state.list.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const pending=f.connect(),denied=expect(pending).rejects.toThrow();await vi.waitFor(()=>expect(state.list).toHaveBeenCalledOnce());f.controller.abort();finish({tools:names.map(name=>({name}))});await denied;expect(state.call).not.toHaveBeenCalled();
});
it('denies a late tool response after close without accepting it as an observation',async()=>{
  const f=await fixture(),adapter=await f.connect();let finish!:(value:unknown)=>void;state.call.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const pending=adapter.call('get_flow',{}),denied=expect(pending).rejects.toThrow('closed');await vi.waitFor(()=>expect(state.call).toHaveBeenCalledOnce());await adapter.close();finish({content:[{type:'text',text:'{"observed":true}'}]});await denied;
});
it.each([{isError:true,content:[{type:'text',text:'private provider diagnostic'}]},{content:[{type:'text',text:'{"success":false}'}]},{content:[{type:'text',text:'{"found":false}'}]},{content:[{type:'text',text:'{"error":"private diagnostic"}'}]},{content:[{type:'text',text:'not JSON'}]}])('denies failed or malformed tool outcomes',async response=>{
  const f=await fixture(),adapter=await f.connect();try{state.call.mockResolvedValue(response);await expect(adapter.call('get_flow',{})).rejects.toThrow();}finally{await adapter.close();}
});
it('enforces a byte limit for Unicode response bodies',async()=>{
  const f=await fixture(),adapter=await f.connect();try{state.call.mockResolvedValue({content:[{type:'text',text:JSON.stringify({payload:'€'.repeat(800000)})}]});await expect(adapter.call('get_flow',{})).rejects.toThrow('too large');}finally{await adapter.close();}
});
it('withholds malformed provider response text from the error surfaced to delivery',async()=>{
  const f=await fixture(),adapter=await f.connect();try{state.call.mockResolvedValue({content:[{type:'text',text:'private-response-canary not JSON'}]});const error=await adapter.call('get_flow',{}).catch(error=>error);expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain('invalid JSON');expect((error as Error).message).not.toContain('private-response-canary');}finally{await adapter.close();}
});
it('retains connection and cleanup failures together',async()=>{
  const f=await fixture();state.connect.mockRejectedValue(new Error('Synthetic connection failure'));state.clientClose.mockRejectedValue(new Error('Synthetic client cleanup failure'));const error=await f.connect().catch(error=>error);expect(error).toBeInstanceOf(AggregateError);expect(error.message).toContain('cleanup is unverified');expect(error.errors[0].message).toBe('Synthetic connection failure');expect(state.transportClose).toHaveBeenCalled();
});
it('does not initialize a cancelled or unavailable runtime',async()=>{
  const f=await fixture();f.controller.abort();await expect(f.connect()).rejects.toThrow();expect(state.connect).not.toHaveBeenCalled();vi.stubEnv('SWARM_FLOWAGENT_ENTRY',path.join(f.root,'missing.mjs'));await expect(connectFlowAdapter(f.root,new AbortController().signal)).rejects.toThrow('unavailable');
});

it.each(['{"success":false,"success":true}','{"identityMismatch":true,"identity\\u004Dismatch":false}','{"properties":{"connectionName":"private-binding","connectionName":"approved"}}'])('rejects duplicate provider fields without accepting or echoing them: %s',async text=>{
  const f=await fixture(),adapter=await f.connect();try{state.call.mockResolvedValue({content:[{type:'text',text}]});const error=await adapter.call('get_flow',{}).catch(error=>error);expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain('invalid JSON');expect((error as Error).message).not.toContain('private-binding');}finally{await adapter.close();}
});
it('rejects runtime bytes that change between launch and the authenticated MCP handshake',async()=>{const f=await fixture();state.list.mockImplementation(async()=>{await fs.appendFile(path.join(f.root,'synthetic.mjs'),'\n// changed during admission');return{tools:names.map(name=>({name}))};});await expect(f.connect()).rejects.toThrow('runtime changed');expect(state.call).not.toHaveBeenCalled();expect(state.clientClose).toHaveBeenCalledOnce();});
it('admits initialization and every discovery request at dispatch',async()=>{const f=await fixture(),admit=vi.fn(async()=>{});state.list.mockResolvedValueOnce({tools:names.slice(0,4).map(name=>({name})),nextCursor:'next'}).mockResolvedValueOnce({tools:names.slice(4).map(name=>({name}))});const adapter=await connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:admit});expect(admit).toHaveBeenCalledTimes(3);expect(admit.mock.invocationCallOrder[0]).toBeLessThan(state.connect.mock.invocationCallOrder[0]);expect(admit.mock.invocationCallOrder[1]).toBeLessThan(state.list.mock.invocationCallOrder[0]);expect(admit.mock.invocationCallOrder[2]).toBeLessThan(state.list.mock.invocationCallOrder[1]);await adapter.close();});
it('refuses a second probe discovery page before mutation and preserves the normal twenty-page default',async()=>{const f=await fixture(),admit=vi.fn(async()=>{});state.list.mockResolvedValue({tools:names.map(name=>({name})),nextCursor:'next'});await expect(connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:admit,maxPages:1})).rejects.toThrow('pagination limit');expect(state.list).toHaveBeenCalledOnce();expect(admit).toHaveBeenCalledTimes(2);expect(state.clientClose).toHaveBeenCalledOnce();});
it('does not dispatch a discovery request when its admission fails',async()=>{const f=await fixture(),admit=vi.fn(async()=>{}).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Budget exhausted'));await expect(connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:admit})).rejects.toThrow('Budget exhausted');expect(state.connect).toHaveBeenCalledOnce();expect(state.list).not.toHaveBeenCalled();expect(state.clientClose).toHaveBeenCalledOnce();});
it('refuses an unapproved native entry before any child connection or discovery',async()=>{
 const f=await fixture();await expect(connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:async()=>{},maxPages:1,expectedEntrySha256:'0'.repeat(64)})).rejects.toThrow('before launch');expect(state.connect).not.toHaveBeenCalled();expect(state.list).not.toHaveBeenCalled();expect(state.transport).toBeNull();
});
it('uses an explicit hash-bound canonical entry without changing the default environment',async()=>{
 const f=await fixture(),entry=path.join(f.root,'reviewed.mjs'),text='// reviewed standalone fixture';await fs.writeFile(entry,text);
 const expectedEntrySha256=crypto.createHash('sha256').update(text).digest('hex');state.list.mockResolvedValue({tools:[...names,'create_standalone_flow'].map(name=>({name}))});
 const adapter=await connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:async()=>{},entryPath:entry,expectedEntrySha256,requiredTools:['create_standalone_flow']});
 expect(adapter.metadata?.entrySha256).toBe(expectedEntrySha256);expect(process.env.SWARM_FLOWAGENT_ENTRY).toBe(path.join(f.root,'synthetic.mjs'));expect(state.call).not.toHaveBeenCalled();await adapter.close();
});
it.each(['unbound','hardlink','directory','missing-tool'] as const)('refuses %s explicit runtime admission before provider calls',async mode=>{
 const f=await fixture(),entry=path.join(f.root,'synthetic.mjs'),expectedEntrySha256=crypto.createHash('sha256').update(await fs.readFile(entry)).digest('hex');
 if(mode==='hardlink')await fs.link(entry,path.join(f.root,'other.mjs'));
 const entryPath=mode==='directory'?f.root:entry;
 await expect(connectFlowAdapter(f.root,f.controller.signal,{beforeRequest:async()=>{},entryPath,...mode==='unbound'?{}:{expectedEntrySha256},requiredTools:['create_standalone_flow']})).rejects.toThrow();
 expect(state.call).not.toHaveBeenCalled();if(mode!=='missing-tool')expect(state.connect).not.toHaveBeenCalled();else expect(state.clientClose).toHaveBeenCalledOnce();
});
