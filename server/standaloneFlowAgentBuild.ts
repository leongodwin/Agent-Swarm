import crypto from 'node:crypto';

export const STANDALONE_UPSTREAM_SHA256='c1bd1cf31363a8db2403cb87f6ee52a182528af55d0a3d17c487ae013a1731d3';
export const STANDALONE_ADAPTER_VERSION='3.2.1-as-direct.8';
const start='  server2.tool("create_flow",';
const end='  server2.tool("update_flow",';
const enrichment='enrichedRefs = await enrichRefsWithLogicalNames(ctx.getClient(), envId, enrichedRefs);';
const duplicateFailure='logger.warn(`[no-recreate-guard] listFlows failed during duplicate check (${err instanceof Error ? err.message : String(err)}); allowing create_flow to proceed`);\n      return;';

/** Non-read requests must not enter upstream retry/fallback loops. One manual
 * trigger uses only the connector path; an uncertain response never tries a
 * callback or another invocation transport. Read-only retries remain upstream. */
export function singleAttemptNativeTransports(source:string){
 const prepend=(header:string,guard:string)=>{const at=source.indexOf(header);if(at<0||source.indexOf(header,at+header.length)>=0)throw Error('Native transport structure differs');source=source.slice(0,at)+source.slice(at).replace(header,header+'\n'+guard);};
 const direct='    if (!["GET", "HEAD"].includes(method)) { const token = await this.auth.getAccessToken(); return this.requestWithToken(method, url2, token, body); }';
 prepend('  async ppapiRequest(method, url2, body) {',direct);
 prepend('  async request(method, url2, body) {',direct);
 prepend('  async ppapiRequestWithFallback(envId, ppapiPath, method, body) {','    if (!["GET", "HEAD"].includes(method)) { if (this.ppapiUnavailableEnvs.has(envId)) throw new Error("Standalone non-read fallback is forbidden"); return this.ppapiRequest(method, `${this.ppapiBase(envId)}${ppapiPath}`, body); }');
 prepend('  async classicFlowRpRequest(envId, ppapiPath, method, body) {','    if (!["GET", "HEAD"].includes(method)) throw new Error("Standalone classic non-read transport is forbidden");');
 const publishHeader='  async publishFlow(envId, flowId, opts = {}) {',publishStart=source.indexOf(publishHeader);
 if(publishStart<0||source.indexOf(publishHeader,publishStart+publishHeader.length)>=0)throw Error('Native publish structure differs');
 const publishEnd=source.indexOf('\n  }\n',publishStart+publishHeader.length);if(publishEnd<0)throw Error('Native publish boundary differs');
 // An activation failure, including 409, remains an uncertain outcome. Never
 // switch to Dataverse activation or convert the failure into success.
 const publish=publishHeader+'\n    await this.assertNotManaged(envId, flowId, "publish_flow", opts);\n    const path7 = `/powerautomate/flows/${flowId}/start${this.ppapiFlowQs({})}`;\n    await this.ppapiRequestWithFallback(envId, path7, "POST");\n    const flow = await this.getFlow(envId, flowId);\n    return {alreadyStarted:false, actualState:flow.properties?.state};\n  }\n';
 source=source.slice(0,publishStart)+publish+source.slice(publishEnd+5);
 const header='  async triggerFlowRun(envId, flowId, opts = {}) {',start=source.indexOf(header);if(start<0||source.indexOf(header,start+header.length)>=0)throw Error('Native trigger structure differs');
 const end=source.indexOf('\n  }\n',start+header.length);if(end<0)throw Error('Native trigger boundary differs');
 const trigger=header+'\n    const trigger = await this.resolveTrigger(envId, flowId, opts.triggerName);\n    if (trigger.name !== "manual" || trigger.type !== "Request" || trigger.kind !== "Button" || opts.useCallbackUrl !== undefined) throw new Error("Standalone invocation requires the exact manual Button connector path");\n    assertTriggerInputsSatisfied(trigger, opts.body);\n    const response = await this.runFlowViaLogicFlowsConnector(envId, flowId, opts.body, trigger.name);\n    return {triggered:true, triggerName:trigger.name, triggerKind:trigger.kind, path:"connector", response};\n  }\n';
 return source.slice(0,start)+trigger+source.slice(end+5);
}

/** Bind polling to the identifier returned by this invocation. Missing identity,
 * an unexpected provider resource or an unreadable poll remains unknown. */
export function exactStandaloneRunHandler(source:string){
 const marker='  server2.tool("run_flow",',next='  server2.tool("get_run_history",';
 const at=source.indexOf(marker),end=source.indexOf(next,at),body='async ({ env, flow, body, triggerName, useCallbackUrl, wait, timeout }, extra) => {';
 if(at<0||end<at||source.indexOf(marker,at+marker.length)>=0||source.indexOf(next,end+next.length)>=0)throw Error('Native run registration differs');
 const start=source.indexOf(body,at);if(start<at||start>=end||source.indexOf(body,start+body.length)<end&&source.indexOf(body,start+body.length)>=0)throw Error('Native run handler differs');
 const replacement=`
    try {
      if (wait !== true || timeout !== 30) throw new Error("Standalone run requires its fixed bounded wait");
      const envId = ctx.resolveEnv(env), c = ctx.getClient();
      const trigger = await c.triggerFlowRun(envId, flow, {body,triggerName,useCallbackUrl});
      const runId = trigger.response?.runId;
      if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(runId)) throw new Error("Invocation run identity unavailable; outcome unknown");
      const deadline = Date.now() + 30000;
      for (let poll=0; poll<15 && Date.now()<deadline; poll++) {
        const run = await c.getRunDetails(envId, flow, runId);
        const expected = "/providers/Microsoft.ProcessSimple/environments/"+envId+"/flows/"+flow+"/runs/"+runId;
        if (run.name !== runId || typeof run.id !== "string" || run.id.toLowerCase() !== expected.toLowerCase()) throw new Error("Invocation run resource differs; outcome unknown");
        if (["Succeeded","Failed","TimedOut","Cancelled"].includes(run.properties?.status)) return safeResult({triggered:true,runId,invocationRunId:runId,status:run.properties.status,startTime:run.properties.startTime,endTime:run.properties.endTime});
        if (run.properties?.status !== "Running" && run.properties?.status !== "Waiting") throw new Error("Invocation run state unknown");
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      throw new Error("Invocation not observed terminal within fixed bound; outcome unknown");
    } catch(error) { return safeError(error); }
  });
`;
 return source.slice(0,start+body.length)+replacement+source.slice(end);
}

/** Lifetime provider dispatch ceiling, below SDK retry/pagination loops. Failed
 * requests consume budget too. Redirects cannot silently issue more requests. */
export function boundedStandaloneProvider(source:string){
 const header='async function fetchWithNetworkError(url2, init) {',at=source.indexOf(header);
 if(at<0||source.indexOf(header,at+header.length)>=0||source.includes('function admitStandaloneProvider('))throw Error('Native provider boundary differs');
 const dispatch='return await fetch(url2, init);',end=source.indexOf('\n}\n',at);
 const part=source.slice(at,end);if(end<0||part.split(dispatch).length!==2)throw Error('Native provider dispatch differs');
 const guard='function admitStandaloneProvider() {\n  const attempts = admitStandaloneProvider.attempts ?? 0;\n  if (attempts >= 64) throw new Error("Standalone provider request ceiling reached; outcome unknown");\n  admitStandaloneProvider.attempts = attempts + 1;\n}\n';
 return source.slice(0,at)+guard+part.replace(header,header+'\n  admitStandaloneProvider();').replace(dispatch,'return await fetch(url2, {...init, redirect:"error"});')+source.slice(end);
}

/** A page cap or caller stop condition cannot become absence evidence. Keep
 * the upstream page limit; any unresolved continuation refuses the operation. */
export function completeStandaloneInventory(source:string){
 const header='async function followPagination(fetchPage, maxPages = DEFAULT_MAX_PAGES, stopWhen, onLimitReached) {',at=source.indexOf(header);
 if(at<0||source.indexOf(header,at+header.length)>=0)throw Error('Native inventory pagination differs');
 const end=source.indexOf('\n}\n',at);if(end<0)throw Error('Native inventory pagination boundary differs');
 const body=source.slice(at,end),terminal='  return allItems;';if(body.split(terminal).length!==2)throw Error('Native inventory terminal differs');
 return source.slice(0,at)+body.replace(terminal,'  if (response.nextLink) throw new Error("Standalone inventory coverage incomplete; creation refused");\n'+terminal)+source.slice(end);
}

/** Reproducible local compatibility build, never an edit to the installed plugin.
 * Only the reviewed 3.2.1 input is accepted. Existing managed guards, native
 * transport, authentication and lifecycle tools remain upstream code. This
 * builder does not launch a server or grant any tenant execution authority. */
export function buildStandaloneFlowAgent(upstream:Uint8Array){
 const sourceSha256=crypto.createHash('sha256').update(upstream).digest('hex');
 if(sourceSha256!==STANDALONE_UPSTREAM_SHA256)throw Error('Standalone adapter upstream differs from the pinned reviewed source');
 const built=transformStandaloneFlowAgent(Buffer.from(upstream).toString('utf8'));
 const source=fixedStandaloneServerInitialization(withoutStandaloneTelemetry(built.source));
 return {...built,source,entrySha256:crypto.createHash('sha256').update(source).digest('hex')};
}

/** This stdio entry accepts its fixed config only; injected clients, sessions
 * and tool observers are outside the dedicated single-owner protocol. */
export function fixedStandaloneServerInitialization(source:string){
 const header='async function createMcpServer(authProvider, deps = {}) {',at=source.indexOf(header);
 if(at<0||source.indexOf(header,at+header.length)>=0)throw Error('Standalone server initialization differs');
 const environment='  function telemetryEnvironment(',context='  function getActiveToolContext()',wrapper='  if (deps.getContext || deps.onToolStart || deps.onToolEnd) {',tools='  server2.tool("whoami",';
 const first=source.indexOf(environment,at),last=source.indexOf(context,first),begin=source.indexOf(wrapper,last),end=source.indexOf(tools,begin);
 if(first<at||last<first||begin<last||end<begin||source.indexOf(environment,first+environment.length)>=0||source.indexOf(wrapper,begin+wrapper.length)>=0)throw Error('Standalone observer boundary differs');
 return (source.slice(0,first)+source.slice(last,begin)+source.slice(end)).replace(header,header+'\n  if (Object.keys(deps).some(key => key !== "config")) throw new Error("Standalone stdio forbids injected clients, contexts and observers");');
}

/** The fixed stdio candidate installs no external tool telemetry observer. */
export function withoutStandaloneTelemetry(source:string){
 const original='var server = await createMcpServer(auth, {\n  config: config2,\n  ...createTelemetryObserver({\n    transport: "stdio",\n    getClientInfo: () => server?.server?.getClientVersion?.()\n  })\n});';
 if(source.split(original).length!==2)throw Error('Standalone stdio observer registration differs');
 return source.replace(original,'var server = await createMcpServer(auth, {config: config2});');
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
 const built=completeStandaloneInventory(boundedStandaloneProvider(exactStandaloneRunHandler(singleAttemptNativeTransports((source.slice(0,first)+direct+ownerTool+source.slice(last)).replace(version,`var FLOWAGENT_VERSION = "${STANDALONE_ADAPTER_VERSION}";`).replace(duplicateFailure,'throw new Error("Standalone duplicate-name inventory unavailable; creation refused");')))));
 return {source:built,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),entrySha256:crypto.createHash('sha256').update(built).digest('hex'),version:STANDALONE_ADAPTER_VERSION,kind:'local-standalone-compatibility-candidate' as const,tenantAuthorityGranted:false as const};
}

