import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
const name=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(200);
const settingsSchema=z.object({
  EnvironmentVariables:z.array(z.object({SchemaName:name,Value:z.string().max(65536)}).strict()).max(1000).default([]),
  ConnectionReferences:z.array(z.object({LogicalName:name,ConnectionId:z.string().min(1).max(500).refine(value=>value===value.trim()),ConnectorId:z.string().regex(/^\/providers\/Microsoft\.PowerApps\/apis\/[a-zA-Z0-9_-]+$/i)}).strict()).max(1000).default([]),
}).strict();
interface Mapping {targetComponents:readonly {key:string;kind:string;logicalName:string}[];postDeployActions:readonly {type:string;component:string;connectionId?:string;connectorId?:string}[]}
const connector=(value:string)=>value.replace(/^\/providers\/Microsoft.PowerApps\/apis\//i,'').toLowerCase();
/** JSON.parse validates grammar; preserve key multiplicity so PAC cannot interpret an ambiguous object differently. */
function unambiguousJson(text:string):unknown {
  const value=JSON.parse(text),stack:(Set<string>|null)[]=[],keys:boolean[]=[];
  for(const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)){
    const part=token[0];
    if(part==='{'||part==='['){if(stack.length>=64)throw new Error();stack.push(part==='{'?new Set():null);keys.push(part==='{');}
    else if(part==='}'||part===']'){stack.pop();keys.pop();}
    else if(part===','){if(stack.at(-1))keys[keys.length-1]=true;}
    else if(part.startsWith('"')&&keys.at(-1)){const key=JSON.parse(part);if(stack.at(-1)!.has(key))throw new Error();stack.at(-1)!.add(key);keys[keys.length-1]=false;}
  }
  return value;
}
export async function verifyDeploymentSettings(file:string,expected:string,mapping:Mapping):Promise<string> {
  try{
    const bytes=await readBoundedBytes(file,1024*1024);
    if(!bytes?.length||crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error();
    const parsed=settingsSchema.parse(unambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    for(const names of [parsed.EnvironmentVariables.map(row=>row.SchemaName.toLowerCase()),parsed.ConnectionReferences.map(row=>row.LogicalName.toLowerCase())])if(new Set(names).size!==names.length)throw new Error();
    for(const reference of parsed.ConnectionReferences){
      const components=mapping.targetComponents.filter(row=>row.kind==='connection-reference'&&row.logicalName.toLowerCase()===reference.LogicalName.toLowerCase());
      if(components.length!==1||!mapping.postDeployActions.some(row=>row.type==='connection-reference-check'&&row.component===components[0].key&&row.connectionId===reference.ConnectionId&&row.connectorId&&connector(row.connectorId)===connector(reference.ConnectorId)))throw new Error();
    }
    return expected;
  }catch{throw new Error('Deployment settings are changed, malformed or lack an exact approved connection mapping');}
}
