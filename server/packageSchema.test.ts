import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {ZipFile} from 'yazl';import {afterEach,expect,it} from 'vitest';
import {inspectSolutionPackage} from './packageInventory.ts';
import {comparePackageSchema} from './packageSchema.ts';
import type {TargetAction,TargetComponent} from './targetOperations.ts';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
const relation='<EntityRelationship Name="exp_Report_Line"><EntityRelationshipType>OneToMany</EntityRelationshipType><ReferencedEntityName>exp_Report</ReferencedEntityName><ReferencingEntityName>exp_Line</ReferencingEntityName><ReferencingAttributeName>exp_Report</ReferencingAttributeName><CascadeDelete>Restrict</CascadeDelete><CascadeAssign>NoCascade</CascadeAssign></EntityRelationship>';
const many='<EntityRelationship Name="exp_Report_Tag"><EntityRelationshipType>ManyToMany</EntityRelationshipType><FirstEntityName>exp_Report</FirstEntityName><SecondEntityName>exp_Tag</SecondEntityName><IntersectEntityName>exp_Report_Tag</IntersectEntityName></EntityRelationship>';
const key='<EntityKey><Name>exp_Report_Key</Name><EntityKeyAttributes><AttributeName>exp_code</AttributeName></EntityKeyAttributes></EntityKey>';
async function fixture(options:{relationships?:string;keys?:string;type?:string;behavior?:string}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-schema-package-'));roots.push(root);
  const entries={'solution.xml':`<ImportExportXml><SolutionManifest><UniqueName>Expenses</UniqueName><Version>1.0.0.0</Version><Managed>0</Managed><RootComponents><RootComponent type="1" schemaName="exp_report" behavior="${options.behavior??'0'}"/></RootComponents></SolutionManifest></ImportExportXml>`,'customizations.xml':`<ImportExportXml><Entities><Entity><Name>exp_Report</Name><EntityInfo><entity Name="exp_Report"><attributes><attribute><LogicalName>exp_code</LogicalName><Type>${options.type??'nvarchar'}</Type><RequiredLevel>none</RequiredLevel></attribute></attributes><EntityKeys>${options.keys??key}</EntityKeys></entity></EntityInfo></Entity></Entities><EntityRelationships>${options.relationships??relation+many}</EntityRelationships></ImportExportXml>`};
  const zip=new ZipFile();const chunks:Buffer[]=[];const done=new Promise<Buffer>((resolve,reject)=>{zip.outputStream.on('data',chunk=>chunks.push(chunk));zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject);});for(const [name,value] of Object.entries(entries))zip.addBuffer(Buffer.from(value),name);zip.end();const file=path.join(root,'release.zip');await fs.writeFile(file,await done);return inspectSolutionPackage(file);
}
const manifest: {targetComponents:TargetComponent[];postDeployActions:TargetAction[]}={targetComponents:[{key:'report',kind:'dataverse-table',logicalName:'exp_report'}],postDeployActions:[{id:'schema',type:'schema-check',component:'report',columns:[{name:'exp_code',type:'String',required:'None'}],structure:{keys:[{schemaName:'exp_Report_Key',attributes:['exp_code']}],relationships:[{kind:'one-to-many',schemaName:'exp_Report_Line',referencedEntity:'exp_report',referencedAttribute:'exp_reportid',referencingEntity:'exp_line',referencingAttribute:'exp_report',cascade:{Delete:'Restrict',Assign:'NoCascade'}},{kind:'many-to-many',schemaName:'exp_Report_Tag',entity1:'exp_report',entity2:'exp_tag',intersectEntity:'exp_report_tag'}]}}]};
it('extracts checksum-bound native XML structures and matches the scoped approved facts',async()=>{
  const inventory=await fixture();expect(inventory.archiveComplete).toBe(true);expect(inventory.complianceVerified).toBe(false);
  expect(inventory.tables[0].keys).toEqual([{schemaName:'exp_Report_Key',attributes:['exp_code'],metadataSha256:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
  expect(inventory.relationships).toHaveLength(2);expect(inventory.relationships[0]).toMatchObject({kind:'one-to-many',complete:true,referencingAttribute:'exp_report',cascade:{Delete:'Restrict'}});
  expect(comparePackageSchema(inventory,manifest)).toMatchObject({status:'matched'});
  expect(inventory.resourceInventoryComplete).toBe(false);expect(inventory.issues.join(' ')).toContain('effective security');
});
it.each(['table','column','type','required','key','relationship','cascade','intersect','duplicate-contract'] as const)('rejects packaged %s not covered by the exact approved declaration',async mode=>{
  const inventory=await fixture(),modified=structuredClone(manifest);const action=modified.postDeployActions[0];if(action.type!=='schema-check')throw new Error('fixture');
  if(mode==='table')modified.targetComponents=[];if(mode==='column')action.columns=[];if(mode==='type')action.columns[0].type='Integer';if(mode==='required')action.columns[0].required='ApplicationRequired';
  if(mode==='key')action.structure!.keys![0].attributes=['exp_other'];if(mode==='relationship')action.structure!.relationships=[];
  if(mode==='cascade'){const expected=action.structure!.relationships![0];if(expected.kind==='one-to-many')expected.cascade.Assign='Cascade';}
  if(mode==='intersect'){const expected=action.structure!.relationships![1];if(expected.kind==='many-to-many')expected.intersectEntity='different';}
  if(mode==='duplicate-contract')modified.postDeployActions.push({...action,id:'second'});
  expect(comparePackageSchema(inventory,modified).status).toBe('blocked');
});
it.each([{behavior:'1'},{type:'unrecognized'},{relationships:relation.replace('OneToMany','Unsupported')},{relationships:relation.replace('<CascadeDelete>Restrict</CascadeDelete>','')}])('preserves incomplete source semantics without certifying them: %j',async options=>{
  const inventory=await fixture(options);expect(inventory.archiveComplete).toBe(true);expect(comparePackageSchema(inventory,manifest).status).toBe('unavailable');
});
it.each([{keys:key+key},{keys:key.replace('exp_code','missing_column')},{relationships:relation+relation}])('rejects duplicate or inconsistent source identities: %j',async options=>{
  const inventory=await fixture(options);expect(inventory.archiveComplete).toBe(false);expect(comparePackageSchema(inventory,manifest).status).toBe('unavailable');
});
it('does not accept relationship declarations attached to unrelated approved tables',async()=>{
  const inventory=await fixture(),modified=structuredClone(manifest),action=modified.postDeployActions[0];if(action.type!=='schema-check')throw new Error('fixture');
  modified.targetComponents.push({key:'unrelated',kind:'dataverse-table',logicalName:'exp_other'});
  modified.postDeployActions.push({...structuredClone(action),id:'unrelated-schema',component:'unrelated'});
  action.structure!.relationships=[];
  expect(comparePackageSchema(inventory,modified)).toMatchObject({status:'blocked',reasons:[expect.stringContaining('relationship')]});
});
