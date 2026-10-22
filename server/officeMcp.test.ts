import http from 'node:http';
import express from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {expect,it,vi} from 'vitest';
import {createEngineeringTools} from './ceo.ts';

it('preserves schemas, guarded actions and revocation over stateless HTTP MCP',async()=>{
  let active=true;const acquire=vi.fn(async()=>({lease:'synthetic'}));
  const office=createEngineeringTools(()=> 'ready',{acquire,release:async()=>{}},()=>active?null:'Task cancelled');
  const app=express();app.use(express.json({limit:'1mb'}));
  app.post('/mcp',async(req,res)=>{
    const instance=office.serve();const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void instance.close();});
    try{await instance.connect(transport);await transport.handleRequest(req,res,req.body);}catch{if(!res.headersSent)res.status(500).end();}
  });
  const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};const client=new Client({name:'office-http-test',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
    const listed=await client.listTools();expect(listed.tools.map(tool=>tool.name).sort()).toEqual(['canvas_authoring_acquire','canvas_authoring_release','capability_status','delivery_record','implementation_templates','installed_skills','platform_discovery','read_delivery_source','read_skill','sharepoint_provisioning']);
    expect(listed.tools.find(tool=>tool.name==='canvas_authoring_acquire')?.inputSchema.additionalProperties).toBe(false);
    const args={app:'11111111-1111-4111-8111-111111111111',owner:'fixture'};
    expect((await client.callTool({name:'canvas_authoring_acquire',arguments:{...args,owner:''}})).isError).toBe(true);expect(acquire).not.toHaveBeenCalled();
    expect((await client.callTool({name:'canvas_authoring_acquire',arguments:args})).isError).not.toBe(true);expect(acquire).toHaveBeenCalledOnce();
    active=false;
    expect((await client.callTool({name:'canvas_authoring_acquire',arguments:args})).isError).toBe(true);expect(acquire).toHaveBeenCalledOnce();
  }finally{await client.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
