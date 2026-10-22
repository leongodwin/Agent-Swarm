import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const url=new URL(process.argv[2]);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/mcp'||url.username||url.password||url.search||url.hash)throw Error('Only the configured local browser bridge is supported');
const transport=new StreamableHTTPClientTransport(url),client=new Client({name:'CubeFarm-pipeline-worker',version:'1'});
await client.connect(transport,{timeout:15000});
const tools=await client.listTools(),server=new Server({name:'CubeFarm-native-browser-session',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>tools);
server.setRequestHandler(CallToolRequestSchema,(request,extra)=>client.callTool(request.params,undefined,{signal:extra.signal,timeout:120000}));
let closing=false;
async function close(){if(closing)return;closing=true;try{await transport.terminateSession();}finally{await client.close();await server.close();}}
server.onclose=()=>{void close().finally(()=>process.exit());};
process.stdin.once('end',()=>{void close().finally(()=>process.exit());});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void close().finally(()=>process.exit());});
await server.connect(new StdioServerTransport());
