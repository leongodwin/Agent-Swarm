import {expect,it,vi,afterEach} from 'vitest';
import type {SessionOptions,SessionCallbacks} from './agentRunner.ts';
import type {AgentTerminal} from './terminal.ts';
const native=vi.hoisted(()=>({available:true,start:vi.fn(),reconnect:vi.fn(async()=>[]),protected:vi.fn(()=>({pids:[123,456],markers:['owned-sessions','owned-hooks']})),releaseDesk:vi.fn(async()=>{})}));
vi.mock('./cliRunner.ts',()=>({get terminalsAvailable(){return native.available;},startCliSession:native.start,reconnectClis:native.reconnect,officeProcesses:native.protected,hooksReady:vi.fn(),releaseClis:vi.fn()}));
vi.mock('./workspace.ts',async original=>({...await original<typeof import('./workspace.ts')>(),releaseDesk:native.releaseDesk}));
vi.mock('./tenancy.ts',async original=>({...await original<typeof import('./tenancy.ts')>(),createTenancyService:()=>({})}));
import {realBackend} from './backend.ts';
const opts:SessionOptions={cwd:'synthetic',prompt:'Synthetic request',systemAppend:'',model:'',effort:'medium',browserTesting:false,additionalDirectories:[],role:'dev'};
const callbacks:SessionCallbacks={log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()};
afterEach(()=>{vi.clearAllMocks();native.available=true;});
it.each([{cli:'claude',model:''},{cli:'copilot',model:''},{cli:'codex',model:'anthropic/claude'},{cli:'opencode',model:'unqualified'}] as const)('rejects forbidden backend runtime configuration before terminal dispatch: $cli',configuration=>{
 expect(()=>realBackend.startSession({...opts,...configuration,terminal:{} as AgentTerminal},callbacks)).toThrow();expect(native.start).not.toHaveBeenCalled();
});
it.each([{cli:'gemini',model:'gemini-synthetic'},{cli:'opencode',model:'openai/gpt-synthetic'}] as const)('never silently substitutes nonterminal $cli planning with Codex',configuration=>{
 expect(()=>realBackend.startSession({...opts,...configuration,noTools:true,outputSchema:{type:'object'}},callbacks)).toThrow('provider substitution is disabled');expect(native.start).not.toHaveBeenCalled();
});
it('refuses nonterminal general-purpose work instead of falling back to an unrestricted SDK',()=>{
 expect(()=>realBackend.startSession(opts,callbacks)).toThrow('structured planning');expect(native.start).not.toHaveBeenCalled();
});
it.each([{cli:'codex',model:''},{cli:'gemini',model:'gemini-synthetic'},{cli:'opencode',model:'openai/gpt-synthetic'}] as const)('preserves explicit terminal provider/model selection: $cli',configuration=>{
 const terminal={} as AgentTerminal,handle={send:vi.fn(),stop:vi.fn()};native.start.mockReturnValueOnce(handle);const requested={...opts,...configuration,terminal};expect(realBackend.startSession(requested,callbacks)).toBe(handle);expect(native.start).toHaveBeenCalledExactlyOnceWith(requested,callbacks);
});
it('requires terminal availability before adopting retained work and propagates keeper failures',async()=>{
 const lookup=vi.fn(()=>null);native.available=false;expect(await realBackend.reconnectClis(lookup)).toEqual([]);expect(native.reconnect).not.toHaveBeenCalled();native.available=true;native.reconnect.mockRejectedValueOnce(new Error('Owned keeper unavailable'));await expect(realBackend.reconnectClis(lookup)).rejects.toThrow('Owned keeper unavailable');
});
it('protects current office processes during desk cleanup and does not hide cleanup failure',async()=>{
 await realBackend.releaseDesk('synthetic/project','owned-desk',1234);expect(native.releaseDesk).toHaveBeenCalledWith('synthetic/project','owned-desk',1234,{pids:[123,456],markers:['owned-sessions','owned-hooks']});native.releaseDesk.mockRejectedValueOnce(new Error('Cleanup unverified'));await expect(realBackend.releaseDesk('synthetic/project','owned-desk',1234)).rejects.toThrow('Cleanup unverified');
});
