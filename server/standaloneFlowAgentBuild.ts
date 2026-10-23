import crypto from 'node:crypto';

export const STANDALONE_UPSTREAM_SHA256='c1bd1cf31363a8db2403cb87f6ee52a182528af55d0a3d17c487ae013a1731d3';
export const STANDALONE_ADAPTER_VERSION='3.2.1-as-direct.3';
const start='  server2.tool("create_flow",';
const end='  server2.tool("update_flow",';
const enrichment='enrichedRefs = await enrichRefsWithLogicalNames(ctx.getClient(), envId, enrichedRefs);';
const duplicateFailure='logger.warn(`[no-recreate-guard] listFlows failed during duplicate check (${err instanceof Error ? err.message : String(err)}); allowing create_flow to proceed`);\n      return;';

/** Reproducible local compatibility build, never an edit to the installed plugin.
 * Only the reviewed 3.2.1 input is accepted. Existing managed guards, native
 * transport, authentication and lifecycle tools remain upstream code. This
 * builder does not launch a server or grant any tenant execution authority. */
export function buildStandaloneFlowAgent(upstream:Uint8Array){
 const sourceSha256=crypto.createHash('sha256').update(upstream).digest('hex');
 if(sourceSha256!==STANDALONE_UPSTREAM_SHA256)throw Error('Standalone adapter upstream differs from the pinned reviewed source');
 return transformStandaloneFlowAgent(Buffer.from(upstream).toString('utf8'));
}

/** Structural transformation separated for complete offline negative tests.
 * This is not an admission API: callers must use the hash-checking builder. */
export function transformStandaloneFlowAgent(source:string){
 if(source.includes('"create_standalone_flow"')||source.includes('"read_standalone_flow_owners"'))throw Error('Standalone adapter tool identity collision');
 const unique=(needle:string)=>{const first=source.indexOf(needle);if(first<0||source.indexOf(needle,first+needle.length)>=0)throw Error('Standalone adapter source structure differs');return first;};
 const first=unique(start),last=unique(end),version='var FLOWAGENT_VERSION = "3.2.1";';unique(version);unique(duplicateFailure);
 if(last<=first)throw Error('Standalone adapter create/update ordering differs');
 const original=source.slice(first,last);
 if(original.split(enrichment).length!==2)throw Error('Standalone adapter enrichment structure differs');
 const binding='      let enrichedRefs = connectionRefs;';
 if(original.split(binding).length!==2)throw Error('Standalone adapter binding structure differs');
 const direct=original.replace(start,'  server2.tool("create_standalone_flow",')
  .replace(binding,`      if (allowDuplicate === true) throw new Error("Standalone duplicate override is forbidden");\n      if (!connectionRefs || Object.keys(connectionRefs).length !== 1 || !Object.hasOwn(connectionRefs, "shared_office365") || Object.values(connectionRefs).some(ref => !ref || typeof ref !== "object" || Object.hasOwn(ref, "connectionReferenceLogicalName"))) throw new Error("Standalone flow requires one direct Outlook connection without solution references");\n${binding}`)
  .replace(enrichment,'/* Direct connections are preserved; no Dataverse reference enrichment. */');
 const ownerTool=`  server2.tool("read_standalone_flow_owners", "Read current flow ownership using existing administrator access; never grant or change permissions.", {env: external_exports.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),flow: external_exports.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)}, {readOnlyHint:true,title:"Read Standalone Flow Ownership"}, async ({env,flow}) => {try {return safeResult(await ctx.getClient().adminGetFlowPermissions(ctx.resolveEnv(env),flow));} catch(error) {return safeError(error);}});\n`;
 const built=(source.slice(0,first)+direct+ownerTool+source.slice(last)).replace(version,`var FLOWAGENT_VERSION = "${STANDALONE_ADAPTER_VERSION}";`).replace(duplicateFailure,'throw new Error("Standalone duplicate-name inventory unavailable; creation refused");');
 return {source:built,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),entrySha256:crypto.createHash('sha256').update(built).digest('hex'),version:STANDALONE_ADAPTER_VERSION,kind:'local-standalone-compatibility-candidate' as const,tenantAuthorityGranted:false as const};
}

