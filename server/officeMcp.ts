import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

export interface OfficeToolDefinition {
  name:string;
  description:string;
  inputSchema:z.ZodRawShape;
  handler(args:Record<string,unknown>,extra?:unknown):Promise<CallToolResult>;
}
export interface OfficeMcpConfig {name:string;instance:McpServer}

/** Shared validation for direct demo calls and native MCP transport calls. */
export function tool<S extends z.ZodRawShape>(name:string,description:string,inputSchema:S,handler:(args:z.infer<z.ZodObject<S>>,extra?:unknown)=>Promise<CallToolResult>):OfficeToolDefinition {
  const schema=z.strictObject(inputSchema);
  return {name,description,inputSchema,async handler(args,extra){
    const parsed=schema.safeParse(args);
    if(!parsed.success)return {isError:true,content:[{type:'text',text:'Invalid office tool arguments; execution denied'}]};
    return handler(parsed.data,extra);
  }};
}

/** Model-provider-independent office MCP server. Every transport gets a fresh instance. */
export function createOfficeMcpServer(config:{name:string;version?:string;tools:OfficeToolDefinition[]}):OfficeMcpConfig {
  const instance=new McpServer({name:config.name,version:config.version??'1.0.0'},{maxToolInputElements:10_000});
  for(const definition of config.tools)instance.registerTool(definition.name,{description:definition.description,inputSchema:z.strictObject(definition.inputSchema)},(args,extra)=>definition.handler(args,extra));
  return {name:config.name,instance};
}
