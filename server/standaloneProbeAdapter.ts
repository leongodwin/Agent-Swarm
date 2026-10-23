import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {discoverSkills} from './skillRegistry.ts';
import {buildStandaloneFlowAgent,STANDALONE_ADAPTER_VERSION} from './standaloneFlowAgentBuild.ts';
import {connectFlowAdapter,type FlowAdapter} from './flowAdapter.ts';
import type {StandaloneProbePlan} from './standaloneMetadataProbe.ts';

/** Inspection never generates, repairs or rewrites source during review. */
export async function inspectStandaloneProbeAdapter(home:string,expectedEntrySha256:string){
 const skill=discoverSkills().skills.find(s=>s.id==='power-automate:manage-flows');
 if(!skill)throw Error('Pinned Power Automate skill is unavailable');
 const upstream=path.resolve(path.dirname(skill.file),'..','..','server','mcp.mjs');
 const build=buildStandaloneFlowAgent(await fs.readFile(upstream));
 if(build.entrySha256!==expectedEntrySha256)throw Error('Standalone compatibility build differs from the approved source');
 const entry=path.join(home,'bin','flowagent-standalone-'+build.entrySha256+'.mjs'),stat=await fs.lstat(entry);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(entry)!==path.resolve(entry))throw Error('Standalone compatibility entry is not canonical');
 if(crypto.createHash('sha256').update(await fs.readFile(entry)).digest('hex')!==build.entrySha256)throw Error('Standalone compatibility entry changed');
 return {entry,upstreamSha256:build.sourceSha256,metadata:{name:'flowagent-mcp',version:STANDALONE_ADAPTER_VERSION,entrySha256:build.entrySha256}};
}

/** Called only by the exact independently approved fixed probe executor. */
export async function connectStandaloneProbeAdapter(home:string,cwd:string,plan:StandaloneProbePlan,signal:AbortSignal,admit:()=>Promise<void>):Promise<FlowAdapter>{
 const inspected=await inspectStandaloneProbeAdapter(home,plan.adapter.entrySha256);
 if(!isDeepStrictEqual(inspected.metadata,plan.adapter))throw Error('Exact standalone adapter identity required');
 const adapter=await connectFlowAdapter(cwd,signal,{beforeRequest:admit,maxPages:1,entryPath:inspected.entry,expectedEntrySha256:plan.adapter.entrySha256,requiredTools:['create_standalone_flow','read_standalone_flow_owners']});
 try{
  if(!isDeepStrictEqual(adapter.metadata,inspected.metadata))throw Error('Native standalone adapter identity differs');
  return adapter;
 }catch(error){try{await adapter.close();}catch(cleanup){throw new AggregateError([error,cleanup],'Standalone adapter admission failed and cleanup is unverified');}throw error;}
}
