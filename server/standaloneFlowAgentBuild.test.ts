import {expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import {buildStandaloneFlowAgent,transformStandaloneFlowAgent,STANDALONE_ADAPTER_VERSION} from './standaloneFlowAgentBuild.ts';

import {standaloneTransportFixture} from './testFixtures/standaloneTransport.ts';
const duplicateFailure='logger.warn(`[no-recreate-guard] listFlows failed during duplicate check (${err instanceof Error ? err.message : String(err)}); allowing create_flow to proceed`);\n      return;';
const fixture=standaloneTransportFixture+`var FLOWAGENT_VERSION = "3.2.1";
async function followPagination(fetchPage, maxPages = DEFAULT_MAX_PAGES, stopWhen, onLimitReached) {
  let response = await fetchPage();
  const allItems = response.value;
  return allItems;
}
async function fetchWithNetworkError(url2, init) {
  return await fetch(url2, init);
}
  server2.tool("run_flow", "synthetic", {}, {}, async ({ env, flow, body, triggerName, useCallbackUrl, wait, timeout }, extra) => {});
  server2.tool("get_run_history", "synthetic");
  server2.tool("create_flow", "create", {}, {}, async ({connectionRefs,allowDuplicate}) => {
    try {
      let enrichedRefs = connectionRefs;
      if (enrichedRefs) {
        try {
          enrichedRefs = await enrichRefsWithLogicalNames(ctx.getClient(), envId, enrichedRefs);
        } catch {}
      }
      return await ctx.getClient().createFlow("env", {properties:{connectionReferences:enrichedRefs}});
    } catch (error) {return {error:error.message};}
  });
  server2.tool("update_flow", "unchanged update registration");\nasync function duplicateInventoryGuard(listFlows){try{await listFlows();}catch(err){${duplicateFailure}}}`;
function client(source:string){
 const tools=new Map<string,Function>(),createFlow=vi.fn(async(...args:any[])=>({name:'fixture-created',args})),enrich=vi.fn(()=>{throw Error('Enrichment must never execute');});
 const adminGetFlowPermissions=vi.fn(async(...args:any[])=>({value:[],args})),upstream={createFlow,adminGetFlowPermissions};
 Function('server2','ctx','enrichRefsWithLogicalNames','external_exports','safeResult','safeError',source)({tool:(name:string,...args:any[])=>tools.set(name,args.at(-1))},{getClient:()=>upstream,resolveEnv:(env:string)=>env},enrich,{string:()=>({regex:()=>({})})},(value:unknown)=>value,(error:Error)=>({error:error.message}));
 return{create:tools.get('create_standalone_flow')!,readOwners:tools.get('read_standalone_flow_owners')!,createFlow,adminGetFlowPermissions,enrich,tools};
}
it('preserves exact direct bindings and existing update code without invoking enrichment',async()=>{
 const result=transformStandaloneFlowAgent(fixture),run=client(result.source),refs={shared_office365:{id:'/providers/Microsoft.PowerApps/apis/shared_office365',connectionName:'shared-office365-fixture',source:'Embedded'}};
 await run.create({connectionRefs:refs});
 expect(run.enrich).not.toHaveBeenCalled();expect(run.createFlow).toHaveBeenCalledWith('env',{properties:{connectionReferences:refs}});
 expect(run.tools.has('create_flow')).toBe(false);expect(run.tools.get('update_flow')).toBe('unchanged update registration');
 expect(result.version).toBe(STANDALONE_ADAPTER_VERSION);expect(result.sourceSha256).toBe(crypto.createHash('sha256').update(fixture).digest('hex'));
 expect(result.entrySha256).toBe(crypto.createHash('sha256').update(result.source).digest('hex'));expect(result.tenantAuthorityGranted).toBe(false);
});
it.each([undefined,{}, {other:{}},{shared_office365:{},extra:{}},{shared_office365:null},{shared_office365:1},{shared_office365:{connectionReferenceLogicalName:''}},{shared_office365:{connectionReferenceLogicalName:'quarantined_reference'}}])('refuses invalid/reference mappings before any provider dispatch: %j',async refs=>{
 const run=client(transformStandaloneFlowAgent(fixture).source);expect(await run.create({connectionRefs:refs})).toHaveProperty('error');expect(run.createFlow).not.toHaveBeenCalled();expect(run.enrich).not.toHaveBeenCalled();
});
it.each([
 fixture.replace('  server2.tool("create_flow",','  server2.tool("different",'),
 fixture+'\n  server2.tool("create_flow",',
 fixture.replace('  server2.tool("update_flow",','  server2.tool("different",'),
 fixture.replace('var FLOWAGENT_VERSION = "3.2.1";','var FLOWAGENT_VERSION = "other";'),
 fixture.replace('enrichedRefs = await enrichRefsWithLogicalNames(ctx.getClient(), envId, enrichedRefs);',''),
 fixture.replace('      let enrichedRefs = connectionRefs;','      let changed = connectionRefs;'),
 '  server2.tool("update_flow",\n'+fixture.replace('  server2.tool("update_flow",','  server2.tool("other",'),
])('fails closed on source drift instead of applying a guessed patch',source=>{
 expect(()=>transformStandaloneFlowAgent(source)).toThrow();
});
it('requires the exact reviewed upstream bytes at the production build boundary',()=>{
 expect(()=>buildStandaloneFlowAgent(Buffer.from(fixture))).toThrow('upstream differs');
});


it('reads existing owner permissions without invoking flow creation or enrichment and retains failure',async()=>{
 const run=client(transformStandaloneFlowAgent(fixture).source),args={env:'11111111-1111-4111-8111-111111111111',flow:'22222222-2222-4222-8222-222222222222'};
 await run.readOwners(args);expect(run.adminGetFlowPermissions).toHaveBeenCalledWith(args.env,args.flow);expect(run.createFlow).not.toHaveBeenCalled();expect(run.enrich).not.toHaveBeenCalled();run.adminGetFlowPermissions.mockRejectedValue(Error('Existing access denied'));expect(await run.readOwners(args)).toEqual({error:'Existing access denied'});expect(run.createFlow).not.toHaveBeenCalled();
});
it.each(['create_standalone_flow','read_standalone_flow_owners'])('refuses existing custom tool collision: %s',name=>{expect(()=>transformStandaloneFlowAgent(fixture+'\n"'+name+'";')).toThrow('collision');});

it('forbids duplicate override and fails closed when duplicate inventory cannot be read',async()=>{
 const built=transformStandaloneFlowAgent(fixture),run=client(built.source);expect(await run.create({connectionRefs:{shared_office365:{}},allowDuplicate:true})).toHaveProperty('error');expect(run.createFlow).not.toHaveBeenCalled();
 const guard=Function('server2','ctx','external_exports','safeResult','safeError',built.source+';return duplicateInventoryGuard;')({tool:()=>{}},{},{string:()=>({regex:()=>({})})},(x:unknown)=>x,(x:unknown)=>x);
 await expect(guard(async()=>{throw Error('Unavailable');})).rejects.toThrow('creation refused');await expect(guard(async()=>[])).resolves.toBeUndefined();
});
it('refuses missing duplicate guard instead of silently keeping an upstream fail-open path',()=>{expect(()=>transformStandaloneFlowAgent(fixture.replace(duplicateFailure,''))).toThrow('structure differs');});
