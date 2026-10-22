import path from 'node:path';
import express from 'express';
import type {SessionOptions,SessionCallbacks} from '../server/agentRunner.ts';

/** Bounded synthetic verification server; callers must isolate config before importing server modules. */
export async function createGeminiLiveRuntime(home:string,options:{port?:number;onHook?:(token:string,body:Record<string,unknown>)=>void}={}){
 if(!process.env.SWARM_HOME||path.resolve(process.env.SWARM_HOME)!==path.resolve(home)||process.env.SWARM_PORT!=='0')throw new Error('Isolated runtime configuration is required');
 const runner=await import('../server/cliRunner.ts');
 const {createOfficeMcpServer,tool}=await import('../server/officeMcp.ts');
 const {setToolGovernanceGate}=await import('../server/toolGovernance.ts');
 setToolGovernanceGate(async()=>({status:'blocked',reason:'Synthetic live verification prohibits tools'}));
 const instances=new Set<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>();
 const make=()=>{const config=createOfficeMcpServer({name:'synthetic-verification',tools:[tool('verification_status','Read synthetic scope',{},async()=>({content:[{type:'text',text:'Synthetic verification; no delivery actions'}]}))]});instances.add(config.instance);return config;};
 const office={server:make(),serve:()=>make().instance,call:async()=>{throw new Error('Synthetic verification denies direct tools');}};
 const app=express();app.use(express.json({limit:'1mb'}));
 app.all('/api/mcp/:token',(req,res)=>{void runner.handleMcp(req.params.token,req,res);});
 app.post('/api/hooks/:token',async(req,res)=>{options.onHook?.(req.params.token,req.body);res.json(await runner.handleHook(req.params.token,req.body));});
 const server=app.listen(options.port??0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const port=(server.address() as import('node:net').AddressInfo).port;runner.setOfficeUrl(`http://127.0.0.1:${port}`);
 return {runner,office,port,startSession:(opts:SessionOptions,callbacks:SessionCallbacks)=>runner.startCliSession({...opts,office},callbacks),async close(restart=false){await runner.releaseClis(restart);await Promise.all([...instances].map(instance=>instance.close()));server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
