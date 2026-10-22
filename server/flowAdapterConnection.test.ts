import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({connect:vi.fn(),list:vi.fn(),call:vi.fn(),clientClose:vi.fn(),transportClose:vi.fn(),transport:null as null|{onclose?:()=>void;close():Promise<void>}}));
vi.mock('./skillRegistry.ts',()=>({discoverSkills:()=>({skills:[]})}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js',()=>({StdioClientTransport:class{onclose?:()=>void;closed=false;constructor(){state.transport=this;}async close(){await state.transportClose();if(!this.closed){this.closed=true;this.onclose?.();}}}}));
vi.mock('@modelcontextprotocol/sdk/client/index.js',()=>({Client:class{getServerVersion(){return{name:'synthetic-flowagent',version:'1.0.0'};}connect(...args:unknown[]){return state.connect(...args);}listTools(...args:unknown[]){return state.list(...args);}callTool(...args:unknown[]){return state.call(...args);}async close(){await state.clientClose();await state.transport?.close();}}}));
import {connectFlowAdapter} from './flowAdapter.ts';
const names=['whoami','get_flow','get_flow_context','preflight_flow','publish_flow','disable_flow','get_run_history','get_run_details','get_run_actions','get_run_action_content'];
const roots:string[]=[];
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
