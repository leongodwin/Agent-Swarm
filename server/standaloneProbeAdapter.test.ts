import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({skillFile:'',missing:false,discover:vi.fn(),build:vi.fn(),connect:vi.fn()}));
vi.mock('./skillRegistry.ts',()=>({discoverSkills:()=>{state.discover();return{skills:state.missing?[]:[{id:'power-automate:manage-flows',file:state.skillFile}]};}}));
vi.mock('./standaloneFlowAgentBuild.ts',async()=>({...await vi.importActual('./standaloneFlowAgentBuild.ts'),buildStandaloneFlowAgent:(...args:any[])=>state.build(...args)}));
vi.mock('./flowAdapter.ts',()=>({connectFlowAdapter:(...args:any[])=>state.connect(...args),flowDefinitionForPreflight:(value:unknown)=>structuredClone(value)}));
import {createStandaloneProbeAdapterInspector,inspectStandaloneProbeAdapter,connectStandaloneProbeAdapter} from './standaloneProbeAdapter.ts';
import {STANDALONE_ADAPTER_VERSION} from './standaloneFlowAgentBuild.ts';
import {standaloneProbeFixturePlan} from './testFixtures/standaloneProbe.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('as-standalone-adapter-'))throw Error('Unexpected cleanup target');await fs.rm(root,{recursive:true,force:true});}state.missing=false;vi.resetAllMocks();});
async function fixture(){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'as-standalone-adapter-'));roots.push(home);await fs.mkdir(path.join(home,'server'));await fs.mkdir(path.join(home,'bin'));const original='fixture original',source='fixture compiled',entrySha256=crypto.createHash('sha256').update(source).digest('hex');
 state.skillFile=path.join(home,'skills','manage-flows','SKILL.md');await fs.writeFile(path.join(home,'server','mcp.mjs'),original);const entry=path.join(home,'bin','flowagent-standalone-'+entrySha256+'.mjs');await fs.writeFile(entry,source);
 state.build.mockReturnValue({source,sourceSha256:'a'.repeat(64),entrySha256});const plan=standaloneProbeFixturePlan();plan.adapter={name:'flowagent-mcp',version:STANDALONE_ADAPTER_VERSION,entrySha256};const adapter={metadata:{...plan.adapter},call:vi.fn(),close:vi.fn(async()=>{})};state.connect.mockResolvedValue(adapter);return{home,entry,plan,adapter,source};
}
it('inspects exact existing bytes and dispatches only through pinned-entry admission without environment changes',async()=>{
 const f=await fixture(),before=process.env.SWARM_FLOWAGENT_ENTRY,admit=vi.fn(async()=>{}),signal=new AbortController().signal;
 const inspected=await inspectStandaloneProbeAdapter(f.home,f.plan.adapter.entrySha256);expect(inspected.metadata).toEqual(f.plan.adapter);
 expect(await connectStandaloneProbeAdapter(f.home,f.home,f.plan,signal,admit)).toBe(f.adapter);
 expect(state.connect).toHaveBeenCalledWith(f.home,signal,{beforeRequest:admit,maxPages:1,entryPath:f.entry,expectedEntrySha256:f.plan.adapter.entrySha256,requiredTools:['create_standalone_flow','read_standalone_flow_owners']});expect(process.env.SWARM_FLOWAGENT_ENTRY).toBe(before);expect(f.adapter.call).not.toHaveBeenCalled();
});
it.each(['skill','source','approved-hash','entry-bytes','hardlink','directory','plan-version','native-version','cleanup'] as const)('denies %s admission without a tenant tool call',async mode=>{
 const f=await fixture();if(mode==='skill')state.missing=true;if(mode==='source')state.build.mockImplementation(()=>{throw Error('Pinned source changed');});if(mode==='approved-hash')f.plan.adapter.entrySha256='b'.repeat(64);if(mode==='entry-bytes')await fs.appendFile(f.entry,' changed');if(mode==='hardlink')await fs.link(f.entry,path.join(f.home,'other.mjs'));if(mode==='directory'){await fs.unlink(f.entry);await fs.mkdir(f.entry);}if(mode==='plan-version')(f.plan.adapter as {version:string}).version='other';if(mode==='native-version'||mode==='cleanup')(f.adapter.metadata as {version:string}).version='other';if(mode==='cleanup')f.adapter.close.mockRejectedValue(Error('Cleanup unverified'));
 await expect(connectStandaloneProbeAdapter(f.home,f.home,f.plan,new AbortController().signal,async()=>{})).rejects.toThrow();expect(f.adapter.call).not.toHaveBeenCalled();if(['native-version','cleanup'].includes(mode))expect(f.adapter.close).toHaveBeenCalledOnce();else expect(state.connect).not.toHaveBeenCalled();
});

it('pins a locator within one request but still reads current SDK and upstream bytes',async()=>{const f=await fixture(),inspect=createStandaloneProbeAdapterInspector(f.home);await inspect(f.plan.adapter.entrySha256);state.missing=true;await expect(inspect(f.plan.adapter.entrySha256)).resolves.toHaveProperty('entry',f.entry);expect(state.discover).toHaveBeenCalledTimes(1);await expect(inspectStandaloneProbeAdapter(f.home,f.plan.adapter.entrySha256)).rejects.toThrow('unavailable');await fs.appendFile(f.entry,'changed');await expect(inspect(f.plan.adapter.entrySha256)).rejects.toThrow('changed');expect(state.connect).not.toHaveBeenCalled();});
it('never caches upstream validation through a pinned locator',async()=>{const f=await fixture(),inspect=createStandaloneProbeAdapterInspector(f.home);await inspect(f.plan.adapter.entrySha256);await fs.writeFile(path.join(f.home,'server','mcp.mjs'),'changed upstream');state.build.mockImplementation((bytes:Buffer)=>{expect(bytes.toString()).toBe('changed upstream');throw Error('Pinned upstream changed');});await expect(inspect(f.plan.adapter.entrySha256)).rejects.toThrow('upstream changed');expect(state.build).toHaveBeenCalledTimes(2);});
