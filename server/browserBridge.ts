import http from 'node:http';
import crypto from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema,type Tool,type CallToolResult} from '@modelcontextprotocol/sdk/types.js';

export interface BrowserUpstream{listTools():Promise<{tools:Tool[]}>;callTool(input:{name:string;arguments?:Record<string,unknown>},signal:AbortSignal):Promise<CallToolResult>;close():Promise<void>}
/** One approved native extension connection, retained across worker sessions.
 * One worker owns browser calls at a time. No cookie/token/profile copying. */
export async function startBrowserBridge(upstream:BrowserUpstream,port:number,clock:()=>number=()=>performance.now()){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid loopback bridge port');
 type Session={transport:StreamableHTTPServerTransport;server:Server;lastSeen:number;dispatched:boolean;readOnlyOnly:boolean;lastCompletion:number|null;admitted:number;revoked:boolean;completedCalls:number;lastCallSha256:string|null};
 const tools=(await upstream.listTools()).tools,sessions=new Map<string,Session>();
 let owner:string|null=null,closed=false,inFlight=0,unsafeInFlight=0,quarantined=false,pendingInitializations=0,admitted=0;
 let lastClock:number|null=null,clockValid=true;
 const tick=()=>{const value=clock();if(!Number.isFinite(value)||lastClock!==null&&value<lastClock)clockValid=false;else lastClock=value;return value;};
 let tail:Promise<unknown>=Promise.resolve();
 const listener=http.createServer(async(req,res)=>{
  if(closed){res.writeHead(503).end();return;}
  const address=listener.address();const host=typeof address==='object'&&address?`127.0.0.1:${address.port}`:'';
  if(req.headers.host!==host||req.headers.origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403).end();return;}
  if(req.url==='/status'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({sessions:sessions.size,metadataOnly:[...sessions.values()].filter(s=>!s.dispatched).length,owned:owner!==null,inFlight,quarantined}));return;
  }
  if(req.url!=='/mcp'){res.writeHead(404).end();return;}
  let reserved=false;
  try{
   const sessionId=req.headers['mcp-session-id'];
   if(Array.isArray(sessionId)){res.writeHead(400).end();return;}
   let session=sessionId?sessions.get(sessionId):undefined;
   if(sessionId&&!session){res.writeHead(404).end();return;}
   let body:unknown;
   if(req.method==='POST'){
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>256*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
    body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   }
   if(!session){
    if(req.method!=='POST'||!body||typeof body!=='object'||!('method'in body)||body.method!=='initialize'){res.writeHead(400).end();return;}
    // Abrupt native shutdown may omit DELETE. Reclaim only idle metadata
    // sessions which have NEVER dispatched a browser action. A former owner or
    // uncertain remote outcome is never made reusable by time passing.
    const now=tick();for(const [id,stale] of sessions)if(clockValid&&!stale.dispatched&&id!==owner&&now>=stale.lastSeen&&now-stale.lastSeen>=120000){await stale.server.close();sessions.delete(id);}
    if(sessions.size+pendingInitializations>=8){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Browser session capacity reached; terminate retained sessions. No browser action dispatched.'}));return;}
    pendingInitializations++;reserved=true;
    const server=new Server({name:'CubeFarm-approved-browser-bridge',version:'1'},{capabilities:{tools:{}}});
    const entry={server,lastSeen:now,dispatched:false,readOnlyOnly:true,lastCompletion:null,admitted:0,revoked:false,completedCalls:0,lastCallSha256:null} as Session;
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>crypto.randomUUID(),onsessioninitialized:id=>{sessions.set(id,entry);}});entry.transport=transport;
    server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
    server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
     const id=transport.sessionId;if(closed||!id||sessions.get(id)!==entry||entry.revoked)throw Error('Browser session closed');
     if(!tools.some(tool=>tool.name===request.params.name))throw Error('Unknown native browser tool');
     // Exact tab inventory / inline accessibility snapshot cannot mutate app
     // data. The native readOnly snapshot may recover a crashed/empty browser
     // tab. Read failures are not uncertain tenant writes; other native errors
     // retain quarantine, and no read clears a prior quarantined outcome.
     const readOnly=request.params.name==='browser_tabs'&&request.params.arguments?.action==='list'&&Object.keys(request.params.arguments).length===1||request.params.name==='browser_snapshot'&&Object.keys(request.params.arguments??{}).length===0;
     let recovery:Record<string,unknown>|undefined;
     if(!quarantined&&owner&&owner!==id){
      const previous=sessions.get(owner),at=tick(),last=previous?.lastCompletion;
      // Fence only abandoned, completed read-only observation sessions. No
      // action session, pending/queued call or uncertain outcome can expire.
      if(clockValid&&request.params.name==='browser_tabs'&&readOnly&&previous?.readOnlyOnly&&last!==null&&last!==undefined&&Number.isFinite(at)&&Number.isFinite(last)&&at>=last&&at-last>=120000&&!admitted&&!inFlight&&!previous.admitted){
       const old=owner;recovery={kind:'fenced-idle-read-only-session',previousSessionSha256:crypto.createHash('sha256').update(old).digest('hex'),completedCalls:previous.completedCalls,lastCallSha256:previous.lastCallSha256,idleMs:at-last};previous.revoked=true;sessions.delete(old);owner=id;
       void previous.server.close().catch(()=>{});
      }
     }
     if(quarantined||owner&&owner!==id)return{isError:true,content:[{type:'text',text:'Browser unavailable: another session owns it or a native outcome needs reconciliation.'}]};
     owner=id;
     entry.dispatched=true;entry.readOnlyOnly=entry.readOnlyOnly&&readOnly;entry.admitted++;admitted++;
     const work=tail.catch(()=>{}).then(async()=>{extra.signal.throwIfAborted();if(closed||quarantined||sessions.get(id)!==entry||entry.revoked||owner!==id)throw Error('Browser session ended before dispatch');inFlight++;if(!readOnly)unsafeInFlight++;try{const result=await upstream.callTool(request.params,extra.signal);entry.lastCallSha256=crypto.createHash('sha256').update(JSON.stringify({request:request.params,result})).digest('hex');if(result.isError&&!readOnly)quarantined=true;return recovery?{...result,_meta:{...result._meta,cubefarmReadOnlyHandoff:recovery}}:result;}catch(error){if(!readOnly)quarantined=true;throw error;}finally{inFlight--;if(!readOnly)unsafeInFlight--;}}).finally(()=>{entry.admitted--;admitted--;entry.completedCalls++;const at=tick();entry.lastCompletion=clockValid?at:null;});
     tail=work;return work;
    });
    transport.onclose=()=>{const id=transport.sessionId;if(id){sessions.delete(id);if(owner===id){if(unsafeInFlight)quarantined=true;else owner=null;}}};
    await server.connect(transport);session=entry;
   }
   session.lastSeen=tick();
   await session.transport.handleRequest(req,res,body);
  }catch{if(!res.headersSent)res.writeHead(400);res.end();}finally{if(reserved)pendingInitializations--;}
 });
 await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',()=>{listener.off('error',reject);resolve();});});
 const actual=listener.address();if(!actual||typeof actual==='string')throw Error('Loopback listener unavailable');
 return {endpoint:`http://127.0.0.1:${actual.port}/mcp`,async close(){if(closed)return;closed=true;await Promise.allSettled([...sessions.values()].map(s=>s.server.close()));sessions.clear();owner=null;listener.closeAllConnections();await new Promise<void>(resolve=>listener.close(()=>resolve()));await upstream.close();}};
}
