import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {ZipFile} from 'yazl';import {afterEach,expect,it} from 'vitest';
import {assertSharepointPackage} from './sharepointPackage.ts';
import {inspectSolutionPackage,type ArchiveLimits} from './packageInventory.ts';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
const id='11111111-1111-4111-8111-111111111111';
const solution=(roots=`<RootComponent type="29" id="{${id}}" behavior="0"/>`)=>`<ImportExportXml><SolutionManifest><UniqueName>Expenses</UniqueName><Version>1.0.0.0</Version><Managed>0</Managed><RootComponents>${roots}</RootComponents></SolutionManifest></ImportExportXml>`;
const custom=(extra='')=>`<ImportExportXml><connectionreferences><connectionreference connectionreferencelogicalname="exp_dataverse"><connectorid>/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps</connectorid></connectionreference></connectionreferences><Workflows><Workflow WorkflowId="{${id}}"><Category>5</Category><JsonFileName>/Workflows/flow.json</JsonFileName></Workflow></Workflows>${extra}</ImportExportXml>`;
const flow=(type='OpenApiConnection',api='shared_commondataserviceforapps')=>JSON.stringify({properties:{connectionReferences:{dv:{api:{name:'shared_commondataserviceforapps'},connection:{connectionReferenceLogicalName:'exp_dataverse'}}},definition:{triggers:{tick:{type:'Recurrence'}},actions:{query:{type,inputs:{host:{connectionName:'dv',apiId:`/providers/Microsoft.PowerApps/apis/${api}`,operationId:'ListRecords'},parameters:{entityName:'exp_reports',$select:'exp_title'}}}}}}});
async function zip(entries:Record<string,string|Buffer>,compress=false){const archive=new ZipFile();const chunks:Buffer[]=[];const ready=new Promise<Buffer>((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});for(const [name,body] of Object.entries(entries))archive.addBuffer(Buffer.from(body),name,{compress});archive.end();return ready;}
async function fixture(entries:Record<string,string|Buffer>={'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':flow()}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-package-inventory-'));roots.push(root);const file=path.join(root,'solution.zip');await fs.writeFile(file,await zip(entries));return {root,file};}
const limits:ArchiveLimits={compressedBytes:64*1024*1024,entryBytes:32*1024*1024,expandedBytes:256*1024*1024,entries:10000,ratio:1000};
it.each(['actions','escaped-actions','connector','table'] as const)('refuses a checksum-valid flow with ambiguous %s metadata',async mode=>{
  let source=flow();if(mode==='actions'||mode==='escaped-actions')source=source.replace('"actions":{',`"actions":{"hidden":{"type":"Http"}},"${mode==='escaped-actions'?'act\\u0069ons':'actions'}":{`);
  if(mode==='connector')source=source.replace('"apiId":', '"apiId":"shared_dropbox","apiId":');if(mode==='table')source=source.replace('"entityName":', '"entityName":"private_table","entityName":');
  const {file}=await fixture({'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':source});const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(false);expect(report.resourceInventoryComplete).toBe(false);expect(report.complianceVerified).toBe(false);expect(JSON.stringify(report)).not.toContain('private_table');
});
it('refuses ambiguous nested Canvas datasource JSON without extracting or executing it',async()=>{
  const msapp=await zip({'References/DataSources.json':'{"DataSources":[{"Type":"NativeCDSDataSourceInfo","LogicalName":"private_table","LogicalName":"exp_report"}]}','Properties.json':'{}'});
  const {root,file}=await fixture({'solution.xml':solution('<RootComponent type="300" schemaName="exp_app"/>'),'customizations.xml':'<ImportExportXml><CanvasApps><CanvasApp><Name>exp_app</Name><DocumentUri>/CanvasApps/app.msapp</DocumentUri></CanvasApp></CanvasApps></ImportExportXml>','CanvasApps/app.msapp':msapp});const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(false);expect(report.resourceInventoryComplete).toBe(false);expect(JSON.stringify(report)).not.toContain('private_table');expect(await fs.readdir(root)).toEqual(['solution.zip']);
});
it('derives actual flow references and operations from a checksum-verified package without extracting files',async()=>{
  const {file,root}=await fixture();const report=await inspectSolutionPackage(file);
  expect(report).toMatchObject({archiveComplete:true,resourceInventoryComplete:true,complianceVerified:false,solution:{name:'Expenses',version:'1.0.0.0',managed:false}});
  expect(report.resources[0].schemaReferences).toEqual([{resource:id,entitySet:'exp_reports',columns:['exp_title']}]);
  expect(report.resources[0]).toMatchObject({id,complete:true,connectors:['shared_commondataserviceforapps'],operations:[{type:'Recurrence'},{type:'OpenApiConnection',connector:'shared_commondataserviceforapps',operationId:'ListRecords'}]});
  expect(report.packageSha256).toBe(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'));expect(report.files).toHaveLength(3);expect(await fs.readdir(root)).toEqual(['solution.zip']);
});
it('keeps an unrecognized Dataverse parameter incomplete at both resource and package scope',async()=>{
  const definition=JSON.parse(flow());definition.properties.definition.actions.query.inputs.parameters.savedQuery='private saved query';const {file}=await fixture({'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':JSON.stringify(definition)});
  const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.resources[0].complete).toBe(false);expect(report.issues.join(' ')).toContain('unrecognized parameter');expect(JSON.stringify(report)).not.toContain('private saved query');
});
it('reports unknown operations, opaque components, undeclared files and missing root counterparts as incomplete',async()=>{
  const {file}=await fixture({'solution.xml':solution(`<RootComponent type="29" id="{${id}}"/><RootComponent type="91" id="{22222222-2222-4222-8222-222222222222}"/><RootComponent type="1" schemaName="exp_missing"/>`),'customizations.xml':custom(),'Workflows/flow.json':flow('Http'),'extra.js':'fetch("https://outside.test")'});
  const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.resources[0].complete).toBe(false);for(const finding of ['type 91','unsupported operation','extra.js','declared table'])expect(report.issues.join(' ')).toContain(finding);
});
it('rejects checksum tampering, case aliases, XML declarations and invalid reference mappings',async()=>{
  const good=await fixture();const bytes=await fs.readFile(good.file),offset=bytes.indexOf(Buffer.from('<ImportExportXml>'));bytes[offset+1]^=1;await fs.writeFile(good.file,bytes);expect((await inspectSolutionPackage(good.file)).archiveComplete).toBe(false);
  for(const entries of [{'solution.xml':solution(),'Solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':flow()},{'solution.xml':'<!DOCTYPE ImportExportXml [<!ENTITY x SYSTEM "file:///sensitive">]>'+solution(),'customizations.xml':custom(),'Workflows/flow.json':flow()},{'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':flow('OpenApiConnection','shared_dropbox')}] as Record<string,string>[]){const {file}=await fixture(entries);expect((await inspectSolutionPackage(file)).archiveComplete).toBe(false);}
});
it('validates missing/malformed archives, cancellation and every processing bound',async()=>{
  const {file}=await fixture();for(const constrained of [{...limits,entries:1},{...limits,entryBytes:1},{...limits,expandedBytes:1},{...limits,compressedBytes:1},{...limits,ratio:0},{...limits,ratio:NaN}])expect((await inspectSolutionPackage(file,undefined,constrained)).archiveComplete).toBe(false);
  const cancelled=new AbortController();cancelled.abort();expect((await inspectSolutionPackage(file,cancelled.signal)).issues).toContain('Package inspection cancelled');
  await fs.writeFile(file,'not a ZIP');expect((await inspectSolutionPackage(file)).archiveComplete).toBe(false);expect((await inspectSolutionPackage(file+'.missing')).archiveComplete).toBe(false);
});
it('inventories nested Canvas datasource metadata while retaining its formula/runtime verification blocker',async()=>{
  const msapp=await zip({'References/DataSources.json':JSON.stringify({DataSources:[{Type:'NativeCDSDataSourceInfo',Name:'Reports',LogicalName:'exp_report',DatasetName:'default.cds'},{Type:'FutureSource'}]}),'Properties.json':'{}','Header.json':'{}'});
  const {file}=await fixture({'solution.xml':solution(`<RootComponent type="300" schemaName="exp_app"/>`),'customizations.xml':'<ImportExportXml><CanvasApps><CanvasApp><Name>exp_app</Name><DocumentUri>/CanvasApps/app.msapp</DocumentUri></CanvasApp></CanvasApps></ImportExportXml>','CanvasApps/app.msapp':msapp});
  const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.files.some(file=>file.path.includes('!/References/DataSources.json'))).toBe(true);expect(report.resources[0]).toMatchObject({kind:'canvas',complete:false,tables:['exp_report'],connectors:['shared_commondataserviceforapps']});expect(report.issues.join(' ')).toContain('unsupported datasource');
});
it('keeps schema-reference overflow explicit rather than certifying a truncated inventory',async()=>{
  const definition=JSON.parse(flow()),operation=definition.properties.definition.actions.query;
  definition.properties.definition.actions=Object.fromEntries(Array.from({length:301},(_,index)=>[`query_${index}`,operation]));
  const {file}=await fixture({'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':JSON.stringify(definition)});const report=await inspectSolutionPackage(file);
  expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.resources[0].schemaReferences).toHaveLength(300);expect(report.issues.join(' ')).toContain('schema references exceed');
});
it('does not silently approve legacy Dataverse schema/environment semantics',async()=>{
  const definition=JSON.parse(flow());definition.properties.connectionReferences.dv.api.name='shared_commondataservice';definition.properties.definition.actions.query.inputs.host.apiId='shared_commondataservice';
  const {file}=await fixture({'solution.xml':solution(),'customizations.xml':custom().replaceAll('shared_commondataserviceforapps','shared_commondataservice'),'Workflows/flow.json':JSON.stringify(definition)});const report=await inspectSolutionPackage(file);
  expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.issues.join(' ')).toContain('legacy Dataverse connector');
});
it('rejects traversal and special-file ZIP entries without touching the filesystem',async()=>{
  const {file,root}=await fixture({'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':flow(),'safe.txt':'payload'});
  const original=await fs.readFile(file);const damaged=Buffer.from(original);let cursor=0;while((cursor=damaged.indexOf(Buffer.from('safe.txt'),cursor))!==-1){damaged.write('../a.txt',cursor);cursor+=8;}await fs.writeFile(file,damaged);
  expect((await inspectSolutionPackage(file)).archiveComplete).toBe(false);expect(await fs.readdir(root)).toEqual(['solution.zip']);
  const special=Buffer.from(original);const central=special.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));special.writeUInt32LE((0xa1ff<<16)>>>0,central+38);await fs.writeFile(file,special);expect((await inspectSolutionPackage(file)).archiveComplete).toBe(false);
});
it('handles compressed entries and exposes otherwise hidden customization settings',async()=>{
  const {file}=await fixture();await fs.writeFile(file,await zip({'solution.xml':solution(),'customizations.xml':custom('<OrganizationSettings><SecuritySetting>1</SecuritySetting></OrganizationSettings>'),'Workflows/flow.json':flow()},true));const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(false);expect(report.issues.join(' ')).toContain('OrganizationSettings');
});

it('preserves supported flow nesting when JSON containers exceed the settings-file depth bound',async()=>{
  const definition=JSON.parse(flow());let actions=definition.properties.definition.actions;
  for(let depth=0;depth<32;depth++)actions={branch:{type:'Switch',cases:{named:{case:'Synthetic',actions}}}};
  definition.properties.definition.actions=actions;const {file}=await fixture({'solution.xml':solution(),'customizations.xml':custom(),'Workflows/flow.json':JSON.stringify(definition)});const report=await inspectSolutionPackage(file);expect(report.archiveComplete).toBe(true);expect(report.resourceInventoryComplete).toBe(true);expect(report.resources[0].operations).toHaveLength(34);
});

const spList='22222222-2222-4222-8222-222222222222',spSite='https://example.sharepoint.com/sites/probe';
function spContract(){return {plan:{schemaVersion:1,tenantId:id,username:'maker@example.test',siteUrl:spSite,siteCollectionId:id,webId:id,resources:[{key:'Requests',displayName:'Probe Requests',template:'genericList',columns:[{name:'Status',kind:'choice',required:true,choices:['New','Processed']}]}]},bindings:[{key:'Requests',listId:spList}]};}
async function spCanvas(source:Record<string,unknown>){return fixture({'solution.xml':solution('<RootComponent type="300" schemaName="exp_app"/>'),'customizations.xml':'<ImportExportXml><CanvasApps><CanvasApp><Name>exp_app</Name><DocumentUri>/CanvasApps/app.msapp</DocumentUri></CanvasApp></CanvasApps></ImportExportXml>','CanvasApps/app.msapp':await zip({'References/DataSources.json':JSON.stringify({DataSources:[source]}),'Properties.json':'{}'})});}
const spSource=()=>({Type:'ConnectedDataSourceInfo',Name:'Requests',DatasetName:spSite,TableName:spList,ApiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline'});
it('reads genuine-shaped nested Canvas SharePoint bindings while retaining formula and runtime blockers',async()=>{
 const {file}=await spCanvas(spSource()),inventory=await inspectSolutionPackage(file);expect(inventory.archiveComplete).toBe(true);expect(inventory.resourceInventoryComplete).toBe(false);
 expect(inventory.resources[0]).toMatchObject({kind:'canvas',complete:false,tables:[],connectors:['shared_sharepointonline'],sharepointSources:[{siteUrl:spSite,listId:spList,sourceName:'Requests'}]});
 expect(assertSharepointPackage(inventory,spContract()).sources).toHaveLength(1);
});
it.each(['site','list','invalid-list','missing-app','missing-binding','missing-source'] as const)('rejects packaged SharePoint %s before deployment',async mode=>{
 const source=spSource();if(mode==='site')source.DatasetName='https://other.sharepoint.com/sites/probe';if(mode==='list')source.TableName=id;if(mode==='invalid-list')source.TableName='@parameters(list)';
 const {file}=await spCanvas(source),inventory=await inspectSolutionPackage(file);if(mode==='missing-app')inventory.resources=[];if(mode==='missing-binding')inventory.resources[0].sharepointSources=[{siteUrl:spSite,listId:id,sourceName:'Other'}];if(mode==='missing-source')delete inventory.resources[0].sharepointSources;
 expect(()=>assertSharepointPackage(inventory,spContract())).toThrow();
});
it('derives literal SharePoint flow targets and rejects wrong-site imports',async()=>{
 const body=JSON.parse(flow('OpenApiConnection','shared_sharepointonline'));body.properties.connectionReferences={sp:{api:{name:'shared_sharepointonline'},connection:{connectionReferenceLogicalName:'exp_sp'}}};const action=body.properties.definition.actions.query;action.inputs.host.connectionName='sp';action.inputs.parameters={dataset:spSite,table:spList};
 const {file}=await fixture({'solution.xml':solution(),'customizations.xml':custom().replaceAll('exp_dataverse','exp_sp').replaceAll('shared_commondataserviceforapps','shared_sharepointonline'),'Workflows/flow.json':JSON.stringify(body)}),inventory=await inspectSolutionPackage(file);
 expect(()=>assertSharepointPackage(inventory,spContract(),[{kind:'canvas',logicalName:'exp_missing'}])).toThrow('Expected Canvas');
 expect(assertSharepointPackage(inventory,spContract()).sources[0]).toMatchObject({listId:spList,siteUrl:spSite});
 const mixed=structuredClone(body);mixed.properties.definition.actions.unresolved=structuredClone(action);mixed.properties.definition.actions.unresolved.inputs.parameters.table='@parameters(list)';const other=await fixture({'solution.xml':solution(),'customizations.xml':custom().replaceAll('exp_dataverse','exp_sp').replaceAll('shared_commondataserviceforapps','shared_sharepointonline'),'Workflows/flow.json':JSON.stringify(mixed)});const unresolved=await inspectSolutionPackage(other.file);expect(unresolved.resources[0].sharepointSources).toHaveLength(1);expect(()=>assertSharepointPackage(unresolved,spContract())).toThrow('explicit site/list');
 inventory.resources[0].sharepointSources![0].siteUrl='https://other.sharepoint.com/sites/probe';expect(()=>assertSharepointPackage(inventory,spContract())).toThrow('approved target');
});
