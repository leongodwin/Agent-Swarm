import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ZipFile} from 'yazl';
import {afterEach,expect,it,vi} from 'vitest';
import {inspectSolutionPackage} from './packageInventory.ts';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:10});});
const id='11111111-1111-4111-8111-111111111111';
const manifest=(components='',identity='<UniqueName>Synthetic</UniqueName><Version>1.0.0.0</Version><Managed>1</Managed>')=>`<ImportExportXml><SolutionManifest>${identity}<RootComponents>${components}</RootComponents></SolutionManifest></ImportExportXml>`;
const metadata=(body='<Entities/>')=>`<ImportExportXml>${body}</ImportExportXml>`;
async function zip(entries:Record<string,string|Buffer>){const archive=new ZipFile(),chunks:Buffer[]=[];const result=new Promise<Buffer>((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});for(const [name,bytes] of Object.entries(entries))archive.addBuffer(Buffer.from(bytes),name,{compress:false});archive.end();return result;}
async function inspect(custom:string,components='',extra:Record<string,string|Buffer>={},solution=manifest(components)){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cf-runtime-inventory-'));roots.push(root);const file=path.join(root,'synthetic.zip');await fs.writeFile(file,await zip({'solution.xml':solution,'customizations.xml':custom,...extra}));return {root,file,report:await inspectSolutionPackage(file)};}
const column=(name='exp_name',type='nvarchar')=>`<attribute><LogicalName>${name}</LogicalName><Type>${type}</Type><RequiredLevel>none</RequiredLevel></attribute>`;
const entity=(attrs=column(),keys='',name='exp_report',infoName=name,extra='')=>`<Entity><Name>${name}</Name><EntityInfo><entity Name="${infoName}"><attributes>${attrs}</attributes>${keys}</entity></EntityInfo>${extra}</Entity>`;
const key=(name='exp_unique',columns='<AttributeName>exp_name</AttributeName>')=>`<EntityKeys><EntityKey><Name>${name}</Name><EntityKeyAttributes>${columns}</EntityKeyAttributes></EntityKey></EntityKeys>`;
const rootTable='<RootComponent type="1" schemaName="exp_report" behavior="0"/>';

it('inventories declared full-table attributes, exact key columns and managed identity without claiming compliance',async()=>{
  const {report}=await inspect(metadata(`<Entities>${entity(column(),key())}</Entities>`),rootTable);expect(report).toMatchObject({archiveComplete:true,resourceInventoryComplete:true,complianceVerified:false,solution:{managed:true},tables:[{name:'exp_report',partial:false,referenceOnly:false,attributes:[{name:'exp_name',type:'nvarchar',required:'none'}],keys:[{schemaName:'exp_unique',attributes:['exp_name']}]}]});expect(report.tables[0].attributes[0].metadataSha256).toMatch(/^[a-f0-9]{64}$/);expect(report.tables[0].keys[0].metadataSha256).toMatch(/^[a-f0-9]{64}$/);
});

it.each([
  ['duplicate table',`<Entities>${entity()}${entity()}</Entities>`],
  ['mismatched metadata',`<Entities>${entity(column(),'','exp_report','exp_other')}</Entities>`],
  ['invalid logical name',`<Entities>${entity(column(),'','../private')}</Entities>`],
  ['duplicate column',`<Entities>${entity(column()+column())}</Entities>`],
  ['invalid key name',`<Entities>${entity(column(),key('invalid key'))}</Entities>`],
  ['missing key column',`<Entities>${entity(column(),key('exp_unique','<AttributeName>exp_missing</AttributeName>'))}</Entities>`],
  ['duplicate key column',`<Entities>${entity(column(),key('exp_unique','<AttributeName>exp_name</AttributeName><AttributeName>exp_name</AttributeName>'))}</Entities>`],
  ['empty key',`<Entities>${entity(column(),key('exp_unique',''))}</Entities>`],
  ['ambiguous key names',`<Entities>${entity(column(),`<EntityKeys>${key().replace(/<\/?EntityKeys>/g,'')}${key('EXP_UNIQUE').replace(/<\/?EntityKeys>/g,'')}</EntityKeys>`)}</Entities>`],
  ['too many key columns',`<Entities>${entity(Array.from({length:17},(_,i)=>column('exp_'+i)).join(''),key('exp_unique',Array.from({length:17},(_,i)=>`<AttributeName>exp_${i}</AttributeName>`).join('')))}</Entities>`],
  ['too many keys',`<Entities>${entity(column(),`<EntityKeys>${Array.from({length:11},(_,i)=>key('exp_key_'+i).replace(/<\/?EntityKeys>/g,'')).join('')}</EntityKeys>`)}</Entities>`],
])('rejects structurally ambiguous schema: %s',async(_description,body)=>{const {root,report}=await inspect(metadata(body),rootTable);expect(report.archiveComplete).toBe(false);expect(report.resourceInventoryComplete).toBe(false);expect(report.complianceVerified).toBe(false);expect(await fs.readdir(root)).toEqual(['synthetic.zip']);});

it.each([
  ['no root identity','<RootComponent type="29"/>'],['invalid GUID', '<RootComponent type="29" id="not-guid"/>'],['invalid type','<RootComponent type="0" schemaName="exp_report"/>'],['fractional type','<RootComponent type="1.5" schemaName="exp_report"/>'],['duplicate root',rootTable+rootTable],['duplicate case-insensitive root',rootTable+'<RootComponent type="1" schemaName="EXP_REPORT"/>'],
])('refuses invalid component provenance: %s',async(_description,components)=>{const {report}=await inspect(metadata(),components);expect(report.archiveComplete).toBe(false);});

it.each(['<UniqueName>unsafe name</UniqueName><Version>1.0.0.0</Version><Managed>0</Managed>','<UniqueName>Safe</UniqueName><Version>1.0</Version><Managed>0</Managed>','<UniqueName>Safe</UniqueName><Version>1.0.0.0</Version><Managed>true</Managed>'])('refuses malformed solution identity',async identity=>{const {report}=await inspect(metadata(),'',{},manifest('',identity));expect(report.archiveComplete).toBe(false);expect(report.solution).toBeUndefined();});

it('distinguishes a minimal reference-only table from schema changes concealed in a partial table',async()=>{
  const reference='<Entity><Name>exp_report</Name><EntityInfo><entity Name="exp_report" unmodified="1"><attributes Id="Mscrm.Templates"/></entity></EntityInfo><RibbonDiffXml/></Entity>',components='<RootComponent type="1" schemaName="exp_report" behavior="2"/>';
  const minimal=await inspect(metadata(`<Entities>${reference}</Entities>`),components);expect(minimal.report.tables[0]).toMatchObject({partial:true,referenceOnly:true,attributes:[],keys:[]});
  const changed=await inspect(metadata(`<Entities>${reference.replace('<RibbonDiffXml/>','<RibbonDiffXml><CustomActions><Action>Hidden</Action></CustomActions></RibbonDiffXml>')}</Entities>`),components);expect(changed.report.tables[0]).toMatchObject({partial:true,referenceOnly:false});
});

it('reports undeclared and missing declared resources without confusing archive integrity with semantic completeness',async()=>{
  const {report}=await inspect(metadata(`<Entities>${entity()}</Entities><Workflows><Workflow WorkflowId="${id}"><Category>1</Category></Workflow></Workflows>`),'<RootComponent type="300" schemaName="exp_missing"/><RootComponent type="29" id="'+id+'"/><RootComponent type="91" schemaName="unsupported"/>');
  expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);for(const reason of ['not a declared root','non-cloud-flow adapter','no supported corresponding source','no corresponding source document','additional governance adapter'])expect(report.issues.join(' ')).toContain(reason);
});

const relationship=(name='exp_relationship',body='<EntityRelationshipType>OneToMany</EntityRelationshipType><ReferencedEntityName>exp_report</ReferencedEntityName><ReferencingEntityName>exp_line</ReferencingEntityName><ReferencingAttributeName>exp_report</ReferencingAttributeName><CascadeDelete>Restrict</CascadeDelete>')=>`<EntityRelationship Name="${name}">${body}</EntityRelationship>`;
it('resolves one-to-many primary columns only from unique packaged metadata and preserves supported cascade settings',async()=>{
  const body=`<Entities>${entity(column('exp_reportid','primarykey'))}</Entities><EntityRelationships>${relationship('exp_line_report',undefined).replace('</EntityRelationship>','<CascadeAssign>NoCascade</CascadeAssign><CascadeShare>UserOwned</CascadeShare></EntityRelationship>')}</EntityRelationships>`,{report}=await inspect(metadata(body),rootTable);expect(report.archiveComplete).toBe(true);expect(report.relationships[0]).toMatchObject({kind:'one-to-many',complete:true,referencedAttribute:'exp_reportid',cascade:{Delete:'Restrict',Assign:'NoCascade',Share:'UserOwned'}});expect(report.resourceInventoryComplete).toBe(false);expect(report.issues.join(' ')).toContain('effective security validation');
});

it.each([
  ['invalid endpoint',relationship().replace('<ReferencingEntityName>exp_line','<ReferencingEntityName>../unsafe')],['unknown cascade',relationship().replace('Restrict','FutureCascade')],['missing cascade',relationship().replace('<CascadeDelete>Restrict</CascadeDelete>','')],['unsupported relationship kind',relationship().replace('OneToMany','FutureRelationship')],
])('keeps relationship structure incomplete: %s',async(_description,body)=>{const {report}=await inspect(metadata(`<Entities>${entity(column('exp_reportid','primarykey'))}</Entities><EntityRelationships>${body}</EntityRelationships>`),rootTable);expect(report.archiveComplete).toBe(true);expect(report.relationships[0].complete).toBe(false);expect(report.issues.join(' ')).toContain('additional structure validation');});

it('inventories many-to-many endpoints and refuses duplicate relationship names',async()=>{
  const many=relationship('exp_many','<EntityRelationshipType>ManyToMany</EntityRelationshipType><FirstEntityName>exp_report</FirstEntityName><SecondEntityName>exp_line</SecondEntityName><IntersectEntityName>exp_report_line</IntersectEntityName>'),good=await inspect(metadata(`<EntityRelationships>${many}</EntityRelationships>`));expect(good.report.relationships[0]).toMatchObject({kind:'many-to-many',complete:true,entity1:'exp_report',entity2:'exp_line',intersectEntity:'exp_report_line'});
  const duplicate=await inspect(metadata(`<EntityRelationships>${many}${many.replace('exp_many','EXP_MANY')}</EntityRelationships>`));expect(duplicate.report.archiveComplete).toBe(false);
});

it.each([
  ['missing workflow JSON',metadata(`<Workflows><Workflow WorkflowId="${id}"><Category>5</Category><JsonFileName>/Workflows/missing.json</JsonFileName></Workflow></Workflows>`),{}],
  ['missing Canvas document',metadata('<CanvasApps><CanvasApp><Name>exp_app</Name><DocumentUri>/CanvasApps/missing.msapp</DocumentUri></CanvasApp></CanvasApps>'),{}],
  ['unknown connector',metadata('<connectionreferences><connectionreference connectionreferencelogicalname="exp_ref"><connectorid>unsupported</connectorid></connectionreference></connectionreferences>'),{}],
])('refuses unresolved resource metadata: %s',async(_description,custom,extra)=>{const {report}=await inspect(custom as string,'',extra as Record<string,string>);expect(report.archiveComplete).toBe(false);});

it('requires Canvas datasource structure, deduplicates discovered tables, and retains mandatory formula/runtime verification',async()=>{
  const app=metadata('<CanvasApps><CanvasApp><Name>exp_app</Name><DocumentUri>/CanvasApps/app.msapp</DocumentUri><BackgroundImageUri>/CanvasApps/background.png</BackgroundImageUri><AdditionalUris0>/CanvasApps/extra.bin</AdditionalUris0></CanvasApp></CanvasApps>'),components='<RootComponent type="300" schemaName="exp_app"/>';
  for(const entries of [{'Properties.json':'{}'},{'References/DataSources.json':'{"DataSources":{}}'}] as Record<string,string>[]){const {report}=await inspect(app,components,{'CanvasApps/app.msapp':await zip(entries)});expect(report.archiveComplete).toBe(false);}
  const bytes=await zip({'References/DataSources.json':JSON.stringify({DataSources:[{Type:'NativeCDSDataSourceInfo',LogicalName:'exp_report'},{Type:'NativeCDSDataSourceInfo',LogicalName:'exp_report'},{Type:'OptionSetInfo'},{Type:'ViewInfo'},{Type:'StaticDataSourceInfo'}]})}),good=await inspect(app,components,{'CanvasApps/app.msapp':bytes,'CanvasApps/background.png':'synthetic','CanvasApps/extra.bin':'synthetic'});expect(good.report.archiveComplete).toBe(true);expect(good.report.resources[0]).toMatchObject({tables:['exp_report'],connectors:['shared_commondataserviceforapps'],complete:false});expect(good.report.issues).toHaveLength(1);expect(good.report.issues[0]).toContain('formula, control, library and runtime');
});

const flowMetadata=()=>metadata(`<Workflows><Workflow WorkflowId="${id}"><Category>5</Category><JsonFileName>/Workflows/flow.json</JsonFileName></Workflow></Workflows>`);
const flowRoot=`<RootComponent type="29" id="${id}"/>`;
const flowDefinition=()=>({properties:{connectionReferences:{} as unknown,definition:{triggers:{tick:{type:'Recurrence'}},actions:{} as unknown}}});
it.each(['missing-definition','missing-actions','missing-triggers','missing-references','reference-array','reference-string','array-actions','string-actions','null-operation','missing-operation-type','missing-connection-host','unknown-connection'] as const)('rejects an unsupported flow structure without accepting a partial scan: %s',async variant=>{
  const flow:any=flowDefinition();if(variant==='missing-definition')delete flow.properties.definition;if(variant==='missing-actions')delete flow.properties.definition.actions;if(variant==='missing-triggers')delete flow.properties.definition.triggers;if(variant==='missing-references')delete flow.properties.connectionReferences;if(variant==='reference-array')flow.properties.connectionReferences=[];if(variant==='reference-string')flow.properties.connectionReferences='unsafe';if(variant==='array-actions')flow.properties.definition.actions=[];if(variant==='string-actions')flow.properties.definition.actions='invalid';if(variant==='null-operation')flow.properties.definition.actions={invalid:null};if(variant==='missing-operation-type')flow.properties.definition.actions={invalid:{inputs:{}}};if(variant==='missing-connection-host')flow.properties.definition.actions={invalid:{type:'OpenApiConnection',inputs:{}}};if(variant==='unknown-connection')flow.properties.definition.actions={invalid:{type:'OpenApiConnection',inputs:{host:{apiId:'shared_commondataserviceforapps',connectionName:'missing',operationId:'ListRecords'}}}};const {report}=await inspect(flowMetadata(),flowRoot,{'Workflows/flow.json':JSON.stringify(flow)});expect(report.archiveComplete).toBe(false);expect(report.resourceInventoryComplete).toBe(false);
});

it('walks both conditional branches, switch defaults and named cases while preserving empty cases',async()=>{
  const flow=flowDefinition();flow.properties.definition.actions={condition:{type:'If',actions:{yes:{type:'Compose'}},else:{actions:{no:{type:'Compose'}}}},choose:{type:'Switch',default:{actions:{fallback:{type:'Compose'}}},cases:{named:{actions:{selected:{type:'Compose'}}},empty:{case:'no actions'}}}};const {report}=await inspect(flowMetadata(),flowRoot,{'Workflows/flow.json':JSON.stringify(flow)});expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(true);expect(report.resources[0].operations.map(operation=>operation.type)).toEqual(['Recurrence','If','Compose','Compose','Switch','Compose','Compose']);
});

it.each(['depth','operation-count'] as const)('holds resource inventories exceeding their supported %s processing bound',async variant=>{
  const flow=flowDefinition();let actions:unknown={leaf:{type:'Compose'}};if(variant==='depth')for(let i=0;i<34;i++)actions={nested:{type:'Scope',actions}};else actions=Object.fromEntries(Array.from({length:10001},(_,i)=>['operation_'+i,{type:'Compose'}]));flow.properties.definition.actions=actions;const {report}=await inspect(flowMetadata(),flowRoot,{'Workflows/flow.json':JSON.stringify(flow)});expect(report.archiveComplete).toBe(false);expect(report.resourceInventoryComplete).toBe(false);
});

it('keeps issue diagnostics bounded and deduplicated without certifying an unsupported operation inventory',async()=>{
  const flow=flowDefinition();flow.properties.definition.actions=Object.fromEntries(Array.from({length:110},(_,i)=>['operation_'+i,{type:'UnknownOperation'+i}]));const {report}=await inspect(flowMetadata(),flowRoot,{'Workflows/flow.json':JSON.stringify(flow)});expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.resources[0].complete).toBe(false);expect(report.issues).toHaveLength(100);
  flow.properties.definition.actions={one:{type:'Unknown'},two:{type:'Unknown'}};const duplicate=await inspect(flowMetadata(),flowRoot,{'Workflows/flow.json':JSON.stringify(flow)});expect(duplicate.report.issues).toHaveLength(1);
});

it.each(['tables','attributes','relationships'] as const)('refuses an oversized %s semantic inventory before granting archive completion',async variant=>{
  const body=variant==='tables'?`<Entities>${Array.from({length:101},(_,i)=>entity('','','exp_table'+i)).join('')}</Entities>`:variant==='attributes'?`<Entities>${entity(Array.from({length:5000},(_,i)=>column('exp_'+i)).join(''))}</Entities>`:`<EntityRelationships>${Array.from({length:10001},(_,i)=>`<EntityRelationship Name="exp_${i}"/>`).join('')}</EntityRelationships>`;const {report}=await inspect(metadata(body));expect(report.archiveComplete).toBe(false);
});

it('refuses duplicate resource identities and inventories unrooted resources explicitly',async()=>{
  const flow=flowDefinition(),unrooted=await inspect(flowMetadata(),'',{'Workflows/flow.json':JSON.stringify(flow)});expect(unrooted.report.archiveComplete).toBe(true);expect(unrooted.report.resourceInventoryComplete).toBe(false);expect(unrooted.report.issues.join(' ')).toContain('outside the root component inventory');const duplicated=flowMetadata().replace('</Workflows>',`<Workflow WorkflowId="${id}"><Category>5</Category><JsonFileName>/Workflows/flow.json</JsonFileName></Workflow></Workflows>`),invalid=await inspect(duplicated,flowRoot,{'Workflows/flow.json':JSON.stringify(flow)});expect(invalid.report.archiveComplete).toBe(false);
});

it('reads XML text nodes with attributes without losing the package identity',async()=>{
  const solution=manifest().replace('<UniqueName>Synthetic</UniqueName>','<UniqueName languagecode="1033">Synthetic</UniqueName>');const {report}=await inspect(metadata(),'',{},solution);expect(report.archiveComplete).toBe(true);expect(report.solution?.name).toBe('Synthetic');
});

it.each(['root-missing','manifest-missing','custom-root-missing'] as const)('refuses incomplete XML root authority: %s',async mode=>{
  const solution=mode==='root-missing'?'<Other>Metadata</Other>':mode==='manifest-missing'?'<ImportExportXml><Unknown/></ImportExportXml>':manifest(),custom=mode==='custom-root-missing'?'<Other>Customization</Other>':metadata();const {report}=await inspect(custom,'',{},solution);expect(report.archiveComplete).toBe(false);
});

it('holds a package whose open file metadata changes during the read and always closes its file handle',async()=>{
  const fixture=await inspect(metadata()),open=fs.open.bind(fs);let closed=false;vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const handle=await open(...args);let reads=0;const stat=handle.stat.bind(handle),close=handle.close.bind(handle);handle.stat=(async()=>{const metadata=await stat();if(++reads>1)metadata.mtimeMs++;return metadata;}) as typeof handle.stat;handle.close=async()=>{closed=true;return close();};return handle;});const report=await inspectSolutionPackage(fixture.file);expect(report.archiveComplete).toBe(false);expect(report.packageSha256).toBe('');expect(closed).toBe(true);
});

it.each([false,true])('rejects conflicting file/directory topology regardless of insertion order (%s)',async reversed=>{
  const conflicting:Record<string,string>=reversed?{'container/hidden.txt':'synthetic','container':'ordinary file'}:{'container':'ordinary file','container/hidden.txt':'synthetic'},fixture=await inspect(metadata(),'',conflicting);expect(fixture.report.archiveComplete).toBe(false);expect(fixture.report.resourceInventoryComplete).toBe(false);
});

it.each(['reserved-name','forbidden-character','encrypted','unsupported-compression','invalid-directory-crc'] as const)('holds malformed archive metadata before resource approval: %s',async variant=>{
  const fixture=await inspect(metadata(),'',{'aaa.txt':'synthetic payload'});let bytes:Buffer=await fs.readFile(fixture.file);
  if(variant==='reserved-name'||variant==='forbidden-character'){const original=Buffer.from('aaa.txt'),replacement=Buffer.from(variant==='reserved-name'?'CON.txt':'a?a.txt');for(let cursor=0;(cursor=bytes.indexOf(original,cursor))>=0;cursor+=original.length)replacement.copy(bytes,cursor);}
  else if(variant==='invalid-directory-crc'){const archive=new ZipFile(),chunks:Buffer[]=[];const completed=new Promise<Buffer>((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});archive.addBuffer(Buffer.from(manifest()),'solution.xml',{compress:false});archive.addBuffer(Buffer.from(metadata()),'customizations.xml',{compress:false});archive.addEmptyDirectory('folder/');archive.end();bytes=await completed;let cursor=0;while((cursor=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),cursor))>=0){const length=bytes.readUInt16LE(cursor+28),name=bytes.subarray(cursor+46,cursor+46+length).toString();if(name==='folder/')bytes.writeUInt32LE(1,cursor+16);cursor+=46+length;}}
  else {const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));if(variant==='encrypted')bytes.writeUInt16LE(bytes.readUInt16LE(central+8)|1,central+8);else bytes.writeUInt16LE(99,central+10);}
  await fs.writeFile(fixture.file,bytes);const report=await inspectSolutionPackage(fixture.file);expect(report.archiveComplete).toBe(false);expect(report.resourceInventoryComplete).toBe(false);expect(report.complianceVerified).toBe(false);expect(await fs.readdir(fixture.root)).toEqual(['synthetic.zip']);
});

it('permits an empty directory entry without pretending it is an additional executable package resource',async()=>{
  const fixture=await inspect(metadata()),archive=new ZipFile(),chunks:Buffer[]=[];const completed=new Promise<Buffer>((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});archive.addBuffer(Buffer.from(manifest()),'solution.xml',{compress:false});archive.addBuffer(Buffer.from(metadata()),'customizations.xml',{compress:false});archive.addEmptyDirectory('folder/');archive.end();await fs.writeFile(fixture.file,await completed);const report=await inspectSolutionPackage(fixture.file);expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(true);expect(report.files).toHaveLength(2);
});
