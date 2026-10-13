import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { standardConnectorId } from './standardPolicy.ts';

const sha=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
const array=(value:any):any[]=>value===undefined||value===''?[]:Array.isArray(value)?value:[value];
const text=(value:any):string=>typeof value==='string'?value:typeof value?.['#text']==='string'?value['#text']:'';
const logical=(value:any)=>{const name=text(value).toLowerCase();if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('Invalid logical name');return name;};
const guid=(value:string)=>{const id=value.replace(/[{}]/g,'').toLowerCase();if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))throw new Error('Invalid component ID');return id;};
export interface PackageFile {path:string;bytes:number;sha256:string}
export interface PackageResource {id:string;kind:'cloud-flow'|'canvas';complete:boolean;connectors:string[];tables:string[];operations:{type:string;operationId?:string;connector?:string}[]}
export interface PackageRelationship {schemaName:string;kind:'one-to-many'|'many-to-many'|'unsupported';complete:boolean;metadataSha256:string;referencedEntity?:string;referencingEntity?:string;referencingAttribute?:string;entity1?:string;entity2?:string;intersectEntity?:string;cascade:Record<string,string>}
export interface PackageInventory {
  schemaVersion:1;scope:'package-metadata-inventory';packageSha256:string;archiveComplete:boolean;resourceInventoryComplete:boolean;
  solution?:{name:string;version:string;managed:boolean};files:PackageFile[];
  components:{type:number;id?:string;name?:string;behavior?:string}[];
  tables:{name:string;partial:boolean;attributes:{name:string;type:string;required:string;metadataSha256:string}[];keys:{schemaName:string;attributes:string[];metadataSha256:string}[]}[];
  relationships:PackageRelationship[];
  connections:{name:string;connector:string}[];resources:PackageResource[];issues:string[];complianceVerified:false;
}
export interface ArchiveLimits {compressedBytes:number;entryBytes:number;expandedBytes:number;entries:number;ratio:number}
const defaults:ArchiveLimits={compressedBytes:64*1024*1024,entryBytes:32*1024*1024,expandedBytes:256*1024*1024,entries:10000,ratio:1000};
type Budget={bytes:number;entries:number};
function safeName(name:string) {
  if(name.length>1000||name.normalize('NFC')!==name||/[\x00-\x1f\x7f\\:<>"|?*]/.test(name)||name.startsWith('/')||name.split('/').filter(Boolean).length>32)throw new Error('Unsafe archive path');
  const parts=name.replace(/\/$/,'').split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))throw new Error('Ambiguous archive path');
  return name.toLowerCase();
}
async function archive(bytes:Buffer,prefix:string,report:PackageInventory,budget:Budget,limits:ArchiveLimits,signal?:AbortSignal) {
  if(bytes.length>limits.compressedBytes||typeof zlib.crc32!=='function')throw new Error('Archive input or runtime limit');
  // Microsoft Canvas exports contain legacy backslash paths. Yauzl normalizes
  // them before validation; traversal and normalized aliases still fail below.
  const zip=await fromBufferPromise(bytes,{strictFileNames:false,validateEntrySizes:true});
  const files=new Map<string,Buffer>(),seen=new Set<string>(),regular=new Set<string>(),directories=new Set<string>();
  try {
    for await(const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if(++budget.entries>limits.entries)throw new Error('Archive entry limit');
      const key=safeName(entry.fileName),directory=key.endsWith('/'),plain=key.replace(/\/$/,'');
      if(seen.has(key)||(!directory&&directories.has(plain))||(directory&&regular.has(plain)))throw new Error('Duplicate or conflicting archive path');seen.add(key);
      const parts=plain.split('/');for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(regular.has(parent))throw new Error('Archive file/directory conflict');directories.add(parent);}
      const mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(mode&&mode!==(directory?0x4000:0x8000))throw new Error('Archive links or special files are unsupported');
      if(entry.generalPurposeBitFlag&1||![0,8].includes(entry.compressionMethod))throw new Error('Encrypted or unsupported archive compression');
      if(directory){directories.add(plain);if(entry.uncompressedSize||entry.crc32)throw new Error('Nonempty or invalid directory entry');continue;}
      regular.add(plain);
      if(entry.uncompressedSize>limits.entryBytes||entry.uncompressedSize/Math.max(1,entry.compressedSize)>limits.ratio||(budget.bytes+=entry.uncompressedSize)>limits.expandedBytes)throw new Error('Archive expansion limit');
      const chunks:Buffer[]=[];let size=0,crc=0;const stream=await zip.openReadStreamPromise(entry);
      const abort=()=>stream.destroy(new Error('Archive reading cancelled'));signal?.addEventListener('abort',abort,{once:true});
      try {for await(const chunk of stream){signal?.throwIfAborted();const buffer=Buffer.from(chunk);size+=buffer.length;if(size>entry.uncompressedSize||size>limits.entryBytes)throw new Error('Archive size mismatch');crc=zlib.crc32(buffer,crc);chunks.push(buffer);}}
      finally{signal?.removeEventListener('abort',abort);stream.destroy();}
      if(size!==entry.uncompressedSize||crc!==entry.crc32)throw new Error('Archive checksum or size mismatch');
      const content=Buffer.concat(chunks,size);files.set(key,content);report.files.push({path:prefix+entry.fileName,bytes:size,sha256:sha(content)});
    }
    return files;
  } finally {zip.close();}
}
function xml(buffer:Buffer) {
  const value=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(value)||XMLValidator.validate(value)!==true)throw new Error('Unsafe or malformed XML');
  return new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:false}).parse(value).ImportExportXml;
}
function json(buffer:Buffer) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}
function packagePath(value:any){const path=text(value).replace(/^\//,'');safeName(path);return path.toLowerCase();}

/** Read-only inspection: no extraction, executable code, tenant calls or formula execution.
 * Integrity completion is separate from connector/resource and effective-policy completion. */
export async function inspectSolutionPackage(file:string,signal?:AbortSignal,limits:ArchiveLimits=defaults):Promise<PackageInventory> {
  const report:PackageInventory={schemaVersion:1,scope:'package-metadata-inventory',packageSha256:'',archiveComplete:false,resourceInventoryComplete:false,files:[],components:[],tables:[],relationships:[],connections:[],resources:[],issues:[],complianceVerified:false};
  const issue=(reason:string)=>{if(report.issues.length<100&&!report.issues.includes(reason))report.issues.push(reason);};
  try {
    for(const key of Object.keys(defaults) as (keyof ArchiveLimits)[])if(!Number.isSafeInteger(limits[key])||limits[key]<0||limits[key]>defaults[key])throw new Error('Invalid archive processing bounds');
    signal?.throwIfAborted();const handle=await fs.open(file,'r');let bytes:Buffer;
    try {const before=await handle.stat();if(!before.isFile()||before.size>limits.compressedBytes)throw new Error('Package file limit');const buffer=Buffer.alloc(before.size+1);let read=0;while(read<buffer.length){signal?.throwIfAborted();const result=await handle.read(buffer,read,buffer.length-read,read);if(!result.bytesRead)break;read+=result.bytesRead;}bytes=buffer.subarray(0,read);const after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size)throw new Error('Package changed during reading');}
    finally {await handle.close();}
    report.packageSha256=sha(bytes);const budget:Budget={entries:0,bytes:0};const files=await archive(bytes,'',report,budget,limits,signal);
    if(!files.has('solution.xml')||!files.has('customizations.xml'))throw new Error('Required solution metadata is missing');
    const manifest=xml(files.get('solution.xml')!).SolutionManifest,custom=xml(files.get('customizations.xml')!);
    if(!manifest||!custom)throw new Error('Invalid solution roots');
    for(const [section,value] of Object.entries(custom))if(!section.startsWith('@_')&&!['Entities','EntityRelationships','Workflows','CanvasApps','connectionreferences','Languages'].includes(section)&&value!==''&&value!==undefined)issue(`Customization section ${section} requires additional semantic validation`);
    const name=text(manifest.UniqueName),version=text(manifest.Version),managed=text(manifest.Managed);
    if(!/^[a-z_][a-z0-9_]*$/i.test(name)||!/^\d+\.\d+\.\d+\.\d+$/.test(version)||!['0','1'].includes(managed))throw new Error('Invalid solution identity');report.solution={name,version,managed:managed==='1'};
    const roots=new Set<string>();
    for(const component of array(manifest.RootComponents?.RootComponent)) {
      const type=Number(component['@_type']);if(!Number.isInteger(type)||type<1)throw new Error('Invalid component type');
      const id=component['@_id']?guid(component['@_id']):undefined,name=component['@_schemaName']?text(component['@_schemaName']):undefined;
      if(!id&&!name)throw new Error('Component has no identity');const key=`${type}:${id??name!.toLowerCase()}`;if(roots.has(key))throw new Error('Duplicate component identity');roots.add(key);
      report.components.push({type,id,name,behavior:component['@_behavior']});
      if(![1,29,300].includes(type))issue(`Component type ${type} requires an additional governance adapter`);
    }
    const entities=array(custom.Entities?.Entity);if(entities.length>100)throw new Error('Table schema inventory limit');
    for(const entity of entities) {
      const name=logical(entity.Name),info=entity.EntityInfo?.entity;const root=report.components.find(component=>component.type===1&&component.name?.toLowerCase()===name);
      if(report.tables.some(table=>table.name===name)||info&&logical(info['@_Name'])!==name)throw new Error('Ambiguous table metadata identity');
      if(!root)issue(`Table ${name} is not a declared root component`);
      const attributes=array(info?.attributes?.attribute).map(attribute=>({name:logical(attribute.LogicalName),type:text(attribute.Type),required:text(attribute.RequiredLevel),metadataSha256:sha(JSON.stringify(attribute))}));
      if(attributes.length>=5000)throw new Error('Attribute schema inventory limit');
      if(new Set(attributes.map(attribute=>attribute.name)).size!==attributes.length)throw new Error('Duplicate attribute');
      const keys=array(info?.EntityKeys?.EntityKey).map(key=>{
        const schemaName=text(key.Name);if(!/^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(schemaName))throw new Error('Invalid package key name');
        const columns=array(key.EntityKeyAttributes?.AttributeName).map(logical);
        if(!columns.length||columns.length>16||new Set(columns).size!==columns.length||columns.some(column=>!attributes.some(attribute=>attribute.name===column)))throw new Error('Invalid package key columns');
        return {schemaName,attributes:columns,metadataSha256:sha(JSON.stringify(key))};
      });
      if(keys.length>10||new Set(keys.map(key=>key.schemaName.toLowerCase())).size!==keys.length)throw new Error('Ambiguous package keys');
      report.tables.push({name,partial:root?.behavior!=='0',attributes,keys});
    }
    const relationships=array(custom.EntityRelationships?.EntityRelationship),relationshipNames=new Set<string>();if(relationships.length>10000)throw new Error('Relationship schema inventory limit');
    for(const relationship of relationships){
      const schemaName=text(relationship['@_Name']);if(!/^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(schemaName)||relationshipNames.has(schemaName.toLowerCase()))throw new Error('Ambiguous package relationship');relationshipNames.add(schemaName.toLowerCase());
      const kind=text(relationship.EntityRelationshipType)==='OneToMany'?'one-to-many':text(relationship.EntityRelationshipType)==='ManyToMany'?'many-to-many':'unsupported';
      const fact:PackageRelationship={schemaName,kind,complete:false,metadataSha256:sha(JSON.stringify(relationship)),cascade:{}};
      try{
        if(kind==='one-to-many'){
          fact.referencedEntity=logical(relationship.ReferencedEntityName);fact.referencingEntity=logical(relationship.ReferencingEntityName);fact.referencingAttribute=logical(relationship.ReferencingAttributeName);
          for(const action of ['Assign','Delete','Archive','Reparent','Share','Unshare','Merge','RollupView'])if(relationship[`Cascade${action}`]!==undefined){const value=text(relationship[`Cascade${action}`]);if(!['NoCascade','Cascade','Active','UserOwned','RemoveLink','Restrict'].includes(value))throw new Error('Unknown cascade behavior');fact.cascade[action]=value;}
          fact.complete=!!fact.cascade.Delete;
        }else if(kind==='many-to-many'){
          fact.entity1=logical(relationship.FirstEntityName);fact.entity2=logical(relationship.SecondEntityName);fact.intersectEntity=logical(relationship.IntersectEntityName);fact.complete=true;
        }
      }catch{fact.complete=false;}
      report.relationships.push(fact);
      if(!fact.complete)issue(`Relationship ${schemaName} requires additional structure validation`);
      issue(`Relationship ${schemaName} still requires navigation, hierarchy and effective security validation`);
    }
    const connections=new Map<string,string>();
    for(const reference of array(custom.connectionreferences?.connectionreference)) {
      const name=logical(reference['@_connectionreferencelogicalname']),connector=standardConnectorId(text(reference.connectorid));
      if(!connector||connections.has(name))throw new Error('Unsupported or duplicate connection reference');connections.set(name,connector);report.connections.push({name,connector});
    }
    const used=new Set(['solution.xml','customizations.xml','[content_types].xml']);
    for(const workflow of array(custom.Workflows?.Workflow)) {
      const id=guid(workflow['@_WorkflowId']);if(text(workflow.Category)!=='5'){issue(`Workflow ${id} needs a non-cloud-flow adapter`);continue;}
      const path=packagePath(workflow.JsonFileName),buffer=files.get(path);if(!buffer)throw new Error('Referenced cloud flow is missing');used.add(path);
      const flow=json(buffer),properties=flow.properties,definition=properties?.definition;
      if(!definition?.actions||!definition?.triggers||!properties.connectionReferences||typeof properties.connectionReferences!=='object'||Array.isArray(properties.connectionReferences))throw new Error('Unsupported flow definition');
      const resource:PackageResource={id,kind:'cloud-flow',complete:true,connectors:[],tables:[],operations:[]};const refs=new Map<string,string>();
      for(const [alias,raw] of Object.entries(properties.connectionReferences) as [string,any][]) {
        const connector=standardConnectorId(raw.api?.name),reference=logical(raw.connection?.connectionReferenceLogicalName);
        if(!connector||connections.get(reference)!==connector)throw new Error('Flow/reference connector mismatch');refs.set(alias,connector);resource.connectors.push(connector);
      }
      let operations=0;
      const walk=(list:any,depth=0)=>{
        if(depth>32||!list||typeof list!=='object'||Array.isArray(list))throw new Error('Unsupported operation structure');
        for(const operation of Object.values(list) as any[]) {
          if(++operations>10000||!operation||typeof operation.type!=='string')throw new Error('Invalid operation');
          const type=operation.type;const record:PackageResource['operations'][number]={type};
          if(['OpenApiConnection','OpenApiConnectionWebhook'].includes(type)) {
            const host=operation.inputs?.host,connector=standardConnectorId(host?.apiId??''),expected=refs.get(host?.connectionName);
            if(!connector||connector!==expected||typeof host.operationId!=='string')throw new Error('Unresolved flow operation connection');record.connector=connector;record.operationId=host.operationId;
          } else if(!['Recurrence','Scope','Foreach','Until','If','Switch','Compose','ParseJson','InitializeVariable','SetVariable','AppendToArrayVariable','AppendToStringVariable','IncrementVariable','DecrementVariable','Select','Query','Table','Join','Terminate','Wait','Response'].includes(type)) {resource.complete=false;issue(`Flow ${id} uses unsupported operation type ${type}`);}
          resource.operations.push(record);
          if(operation.actions)walk(operation.actions,depth+1);if(operation.else?.actions)walk(operation.else.actions,depth+1);if(operation.default?.actions)walk(operation.default.actions,depth+1);
          for(const branch of Object.values(operation.cases??{}) as any[])if(branch.actions)walk(branch.actions,depth+1);
        }
      };
      walk(definition.triggers);walk(definition.actions);resource.connectors=[...new Set(resource.connectors)].sort();report.resources.push(resource);
      if(!roots.has(`29:${id}`))issue(`Flow ${id} is outside the root component inventory`);
    }
    for(const app of array(custom.CanvasApps?.CanvasApp)) {
      const name=logical(app.Name),path=packagePath(app.DocumentUri),buffer=files.get(path);if(!buffer)throw new Error('Canvas document is missing');used.add(path);
      const nested=await archive(buffer,`${path}!/`,report,budget,limits,signal);const ds=nested.get('references/datasources.json');if(!ds)throw new Error('Canvas datasource metadata is missing');
      const datasources=json(ds).DataSources;if(!Array.isArray(datasources))throw new Error('Unsupported Canvas datasource metadata');
      const resource:PackageResource={id:name,kind:'canvas',complete:false,connectors:[],tables:[],operations:[]};
      for(const data of datasources)if(data.Type==='NativeCDSDataSourceInfo') {resource.connectors.push('shared_commondataserviceforapps');resource.tables.push(logical(data.LogicalName));}else if(!['OptionSetInfo','StaticDataSourceInfo','ViewInfo'].includes(data.Type))issue(`Canvas ${name} has unsupported datasource type`);
      resource.connectors=[...new Set(resource.connectors)].sort();resource.tables=[...new Set(resource.tables)].sort();report.resources.push(resource);issue(`Canvas ${name} still requires formula, control, library and runtime binding verification`);
      for(const field of ['BackgroundImageUri','AdditionalUris0'])if(text(app[field]))used.add(packagePath(app[field]));
      if(!report.components.some(component=>component.type===300&&component.name?.toLowerCase()===name))issue(`Canvas ${name} is outside the root component inventory`);
    }
    for(const component of report.components) {
      if(component.type===1&&!report.tables.some(table=>table.name===component.name?.toLowerCase()))issue('A declared table has no corresponding source metadata');
      if(component.type===29&&!report.resources.some(resource=>resource.kind==='cloud-flow'&&resource.id===component.id))issue('A declared workflow has no supported corresponding source definition');
      if(component.type===300&&!report.resources.some(resource=>resource.kind==='canvas'&&resource.id===component.name?.toLowerCase()))issue('A declared Canvas app has no corresponding source document');
    }
    if(new Set(report.resources.map(resource=>resource.id)).size!==report.resources.length)throw new Error('Duplicate resource identity');
    for(const path of files.keys())if(!used.has(path))issue(`Additional package file requires review: ${path}`);
    report.archiveComplete=true;report.resourceInventoryComplete=report.issues.length===0&&report.resources.every(resource=>resource.complete);
  } catch {issue(signal?.aborted?'Package inspection cancelled':'Package integrity, metadata structure or processing limits could not be verified');}
  return report;
}
