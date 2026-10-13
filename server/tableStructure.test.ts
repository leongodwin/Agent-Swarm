import {expect,it,vi} from 'vitest';
import {tableStructureContract,verifyTableStructure} from './tableStructure.ts';
import {targetActionSchema} from './targetOperations.ts';
const id='11111111-1111-4111-8111-111111111111';
const relation={kind:'one-to-many' as const,schemaName:'exp_Report_Line',referencedEntity:'exp_report',referencedAttribute:'exp_reportid',referencingEntity:'exp_line',referencingAttribute:'exp_report',cascade:{Delete:'Restrict' as const,Assign:'NoCascade' as const}};
const key={schemaName:'exp_Report_Key',attributes:['exp_code','exp_owner']};
const relationship={SchemaName:relation.schemaName,MetadataId:id,ReferencedEntity:relation.referencedEntity,ReferencedAttribute:relation.referencedAttribute,ReferencingEntity:relation.referencingEntity,ReferencingAttribute:relation.referencingAttribute,CascadeConfiguration:relation.cascade};
const index={SchemaName:key.schemaName,MetadataId:id,KeyAttributes:['exp_owner','exp_code'],EntityKeyIndexStatus:'Active'};
const request=(rows:unknown[])=>vi.fn(async()=>({value:rows}));
it('compares endpoints/cascades and unordered composite keys with read-only metadata requests',async()=>{
  const read=vi.fn(async(_method:string,resource:string)=>({value:[resource.includes('/Keys?')?index:relationship]}));
  await verifyTableStructure({relationships:[relation],keys:[key]},'exp_report',read);
  expect(read.mock.calls.map(([method])=>method)).toEqual(['GET','GET']);
  expect(read.mock.calls[0][1]).toContain('/OneToManyRelationships?');
  const child=request([relationship]);await verifyTableStructure({relationships:[relation]},'exp_line',child);expect(child.mock.calls[0]).toContainEqual(expect.stringContaining('/ManyToOneRelationships?'));
});
it('permits absent additive structures only during pre-import compatibility checks',async()=>{
  await verifyTableStructure({relationships:[relation],keys:[key]},'exp_report',request([]),true);
  await expect(verifyTableStructure({relationships:[relation]},'exp_report',request([]))).rejects.toThrow('missing');
  await expect(verifyTableStructure({keys:[key]},'exp_report',request([]))).rejects.toThrow('missing');
});
it.each(['ReferencedEntity','ReferencedAttribute','ReferencingEntity','ReferencingAttribute','CascadeConfiguration'] as const)('rejects existing %s drift before and after import',async field=>{
  const changed={...relationship,[field]:field==='CascadeConfiguration'?{Delete:'Cascade',Assign:'NoCascade'}:'different'};
  for(const migration of [true,false])await expect(verifyTableStructure({relationships:[relation]},'exp_report',request([changed]),migration)).rejects.toThrow();
});
it.each(['Pending','InProgress','Failed',2,null,'Unknown'])('denies unusable or unverified key state %s',async status=>{
  for(const migration of [true,false])await expect(verifyTableStructure({keys:[key]},'exp_report',request([{...index,EntityKeyIndexStatus:status}]),migration)).rejects.toThrow();
});
it.each([{attributes:['exp_code']},{attributes:['exp_code','exp_code']}])('rejects changed or ambiguous key columns %j',async ({attributes})=>{
  await expect(verifyTableStructure({keys:[key]},'exp_report',request([{...index,KeyAttributes:attributes}]),true)).rejects.toThrow();
});
it('validates many-to-many endpoints and intersect identity',async()=>{
  const expected={kind:'many-to-many' as const,schemaName:'exp_Report_Tag',entity1:'exp_report',entity2:'exp_tag',intersectEntity:'exp_report_tag'};
  const row={SchemaName:expected.schemaName,MetadataId:id,Entity1LogicalName:expected.entity1,Entity2LogicalName:expected.entity2,IntersectEntityName:expected.intersectEntity};
  await verifyTableStructure({relationships:[expected]},'exp_report',request([row]));
  for(const field of ['Entity1LogicalName','Entity2LogicalName','IntersectEntityName'])await expect(verifyTableStructure({relationships:[expected]},'exp_report',request([{...row,[field]:'different'}]))).rejects.toThrow();
});
it('rejects truncated, duplicate and malformed inventories',async()=>{
  for(const value of [{value:[index,index]},{value:[index,{...index,SchemaName:'different'}]},{value:[index],'@odata.nextLink':'https://unapproved.test'}, {value:[{...index,MetadataId:'invalid'}]}])await expect(verifyTableStructure({keys:[key]},'exp_report',vi.fn(async()=>value))).rejects.toThrow();
});
it('rejects unrelated or malformed contracts before metadata dispatch',async()=>{
  const read=request([]);await expect(verifyTableStructure({relationships:[relation]},'unrelated',read)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
  for(const value of [{relationships:[relation,{...relation,schemaName:relation.schemaName.toUpperCase()}]},{keys:[{...key,attributes:['exp_code','exp_code']}]},{keys:[key,{...key,schemaName:key.schemaName.toUpperCase()}]}])expect(tableStructureContract.safeParse(value).success).toBe(false);
  expect(targetActionSchema.safeParse({id:'schema',type:'schema-check',component:'table',columns:[{name:'exp_code',type:'String',required:'None'}],structure:{keys:[key]}}).success).toBe(true);
});
it('reuses one bounded inventory for multiple declarations',async()=>{
  const read=request([index,{...index,SchemaName:'exp_Other_Key',MetadataId:'22222222-2222-4222-8222-222222222222'}]);
  await verifyTableStructure({keys:[key,{...key,schemaName:'exp_Other_Key'}]},'exp_report',read);expect(read).toHaveBeenCalledOnce();
});
