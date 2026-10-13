import {z} from 'zod';
import type {Request} from './targetOperations.ts';

const logical=z.string().regex(/^[a-z_][a-z0-9_]*$/);
const schemaName=z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(200);
const guid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const cascade=z.enum(['NoCascade','Cascade','Active','UserOwned','RemoveLink','Restrict']);
const cascadeContract=z.strictObject({Delete:cascade,Assign:cascade.optional(),Share:cascade.optional(),Unshare:cascade.optional(),Reparent:cascade.optional(),Merge:cascade.optional(),Archive:cascade.optional(),RollupView:cascade.optional()});
export const relationshipContract=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('one-to-many'),schemaName,referencedEntity:logical,referencedAttribute:logical,referencingEntity:logical,referencingAttribute:logical,cascade:cascadeContract}),
  z.strictObject({kind:z.literal('many-to-many'),schemaName,entity1:logical,entity2:logical,intersectEntity:logical}),
]);
export const keyContract=z.strictObject({schemaName,attributes:z.array(logical).min(1).max(16).refine(values=>new Set(values).size===values.length,'Key columns must be unique')});
const uniqueNames=(values:{schemaName:string}[])=>new Set(values.map(value=>value.schemaName.toLowerCase())).size===values.length;
export const tableStructureContract=z.strictObject({
  relationships:z.array(relationshipContract).max(100).refine(uniqueNames,'Relationship names must be unique').optional(),
  keys:z.array(keyContract).max(10).refine(uniqueNames,'Key names must be unique').optional(),
});
type Contract=z.infer<typeof tableStructureContract>;
const metadata=z.object({SchemaName:schemaName,MetadataId:guid}).passthrough();
const inventory=z.object({value:z.array(metadata).max(4999),'@odata.nextLink':z.never().optional()});
const equalSet=(a:string[],b:string[])=>a.slice().sort().join('\n')===b.slice().sort().join('\n');

/** Verify declared structures only. Missing additive structures are permitted before import;
 * existing drift and unusable indexes are not. Does not certify undeclared metadata/security. */
export async function verifyTableStructure(input:Contract,table:string,request:Request,migration=false){
  const contract=tableStructureContract.parse(input);logical.parse(table);
  const groups=new Map<string,z.infer<typeof metadata>[]>();
  const read=async(collection:string,select:string)=>{
    if(!groups.has(collection)){
      const rows=inventory.parse(await request('GET',`EntityDefinitions(LogicalName='${table}')/${collection}?$select=${select}`)).value;
      if(new Set(rows.map(row=>row.SchemaName.toLowerCase())).size!==rows.length||new Set(rows.map(row=>row.MetadataId.toLowerCase())).size!==rows.length)throw new Error('Table structure inventory is ambiguous');
      groups.set(collection,rows);
    }
    return groups.get(collection)!;
  };
  for(const expected of contract.relationships??[]){
    const belongs=expected.kind==='one-to-many'?expected.referencedEntity===table||expected.referencingEntity===table:expected.entity1===table||expected.entity2===table;
    if(!belongs)throw new Error('Relationship does not belong to the approved table');
    const collection=expected.kind==='many-to-many'?'ManyToManyRelationships':expected.referencedEntity===table?'OneToManyRelationships':'ManyToOneRelationships';
    const select=expected.kind==='many-to-many'?'SchemaName,MetadataId,Entity1LogicalName,Entity2LogicalName,IntersectEntityName':'SchemaName,MetadataId,ReferencedEntity,ReferencedAttribute,ReferencingEntity,ReferencingAttribute,CascadeConfiguration';
    const current=(await read(collection,select)).find(row=>row.SchemaName.toLowerCase()===expected.schemaName.toLowerCase());
    if(!current){if(migration)continue;throw new Error('Declared relationship is missing');}
    if(expected.kind==='many-to-many'){
      const actual=z.object({Entity1LogicalName:logical,Entity2LogicalName:logical,IntersectEntityName:logical}).parse(current);
      if(actual.Entity1LogicalName!==expected.entity1||actual.Entity2LogicalName!==expected.entity2||actual.IntersectEntityName!==expected.intersectEntity)throw new Error('Many-to-many relationship differs from its approved contract');
    }else{
      const actual=z.object({ReferencedEntity:logical,ReferencedAttribute:logical,ReferencingEntity:logical,ReferencingAttribute:logical,CascadeConfiguration:z.record(z.string(),z.unknown())}).parse(current);
      if(actual.ReferencedEntity!==expected.referencedEntity||actual.ReferencedAttribute!==expected.referencedAttribute||actual.ReferencingEntity!==expected.referencingEntity||actual.ReferencingAttribute!==expected.referencingAttribute||Object.entries(expected.cascade).some(([key,value])=>actual.CascadeConfiguration[key]!==value))throw new Error('Relationship endpoints or cascade behavior differ from the approved contract');
    }
  }
  for(const expected of contract.keys??[]){
    const current=(await read('Keys','SchemaName,MetadataId,KeyAttributes,EntityKeyIndexStatus')).find(row=>row.SchemaName.toLowerCase()===expected.schemaName.toLowerCase());
    if(!current){if(migration)continue;throw new Error('Declared alternate key is missing');}
    const actual=z.object({KeyAttributes:z.array(logical).min(1).max(16),EntityKeyIndexStatus:z.literal('Active')}).parse(current);
    if(new Set(actual.KeyAttributes).size!==actual.KeyAttributes.length||!equalSet(actual.KeyAttributes,expected.attributes))throw new Error('Alternate key columns differ from their approved contract');
  }
}
