import {expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import {buildStandaloneFlowAgent,transformStandaloneFlowAgent,STANDALONE_ADAPTER_VERSION} from './standaloneFlowAgentBuild.ts';

const fixture=`var FLOWAGENT_VERSION = "3.2.1";
  server2.tool("create_flow", "create", {}, {}, async ({connectionRefs}) => {
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
  server2.tool("update_flow", "unchanged update registration");`;
function client(source:string){
 const tools=new Map<string,Function>(),createFlow=vi.fn(async(...args:any[])=>({name:'fixture-created',args})),enrich=vi.fn(()=>{throw Error('Enrichment must never execute');});
 const upstream={createFlow};
 Function('server2','ctx','enrichRefsWithLogicalNames',source)({tool:(name:string,...args:any[])=>tools.set(name,args.at(-1))},{getClient:()=>upstream},enrich);
 return{create:tools.get('create_standalone_flow')!,createFlow,enrich,tools};
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

