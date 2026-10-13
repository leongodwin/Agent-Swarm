import {expect,it,vi} from 'vitest';
import {columnContract,compareColumn,verifyColumns,type ColumnContract} from './columnContracts.ts';
import type {Request} from './targetOperations.ts';
const id='11111111-1111-4111-8111-111111111111';
const title:ColumnContract={name:'exp_title',type:'String',required:'ApplicationRequired',constraints:{maxLength:100,format:'Text',access:{create:true,read:true,update:true,secured:false,logical:false,sourceType:0}}};
const actual={LogicalName:'exp_title',MetadataId:id,AttributeType:'String',AttributeTypeName:{Value:'StringType'},RequiredLevel:{Value:'ApplicationRequired'},MaxLength:100,Format:'Text',IsValidForCreate:true,IsValidForRead:true,IsValidForUpdate:true,IsSecured:false,IsLogical:false,SourceType:0};
it('rejects invalid type/constraint combinations, duplicate choices/targets and reversed bounds',()=>{
  expect(columnContract.safeParse(title).success).toBe(true);
  for(const candidate of [{...title,type:'Lookup'},{name:'exp_value',type:'Decimal',required:'None',constraints:{minValue:10,maxValue:0}},{name:'exp_status',type:'Picklist',required:'None',constraints:{options:[1,1]}},{name:'exp_owner',type:'Lookup',required:'None',constraints:{targets:['systemuser','systemuser']}}])expect(columnContract.safeParse(candidate).success).toBe(false);
});
it('validates declared size/format and metadata API access without ignoring false values or missing observations',()=>{
  expect(()=>compareColumn(title,actual)).not.toThrow();
  for(const changed of [{...actual,MaxLength:99},{...actual,Format:'Email'},{...actual,IsSecured:true},{...actual,IsValidForUpdate:false},{...actual,IsValidForRead:undefined},{...actual,SourceType:1},{...actual,LogicalName:'other'}])expect(()=>compareColumn(title,changed)).toThrow();
});
it('permits additive range/length migrations but denies narrowing and applies exact post-import equality',()=>{
  expect(()=>compareColumn({...title,constraints:{maxLength:200}},actual,true)).not.toThrow();expect(()=>compareColumn({...title,constraints:{maxLength:200}},actual)).toThrow();
  expect(()=>compareColumn({...title,constraints:{maxLength:50}},actual,true)).toThrow();
  const column:ColumnContract={name:'exp_amount',type:'Decimal',required:'None',constraints:{minValue:-100,maxValue:100,precision:2}};
  const row={LogicalName:'exp_amount',AttributeType:'Decimal',RequiredLevel:{Value:'None'},MinValue:0,MaxValue:50,Precision:1};
  expect(()=>compareColumn(column,row,true)).not.toThrow();expect(()=>compareColumn({...column,constraints:{minValue:1,maxValue:100}},row,true)).toThrow();expect(()=>compareColumn({...column,constraints:{precision:0}},row,true)).toThrow();
});
it('checks numeric precision source, lookup targets, choice membership, file limits and datetime semantics',()=>{
  const cases:[ColumnContract,object][]=[
    [{name:'exp_money',type:'Money',required:'None',constraints:{precision:2,precisionSource:0}},{LogicalName:'exp_money',AttributeType:'Money',RequiredLevel:{Value:'None'},Precision:2,PrecisionSource:0}],
    [{name:'exp_user',type:'Lookup',required:'None',constraints:{targets:['systemuser']}},{LogicalName:'exp_user',AttributeType:'Lookup',RequiredLevel:{Value:'None'},Targets:['systemuser']}],
    [{name:'exp_status',type:'Picklist',required:'None',constraints:{options:[1,2]}},{LogicalName:'exp_status',AttributeType:'Picklist',RequiredLevel:{Value:'None'},OptionSet:{Options:[{Value:2},{Value:1}]}}],
    [{name:'exp_receipt',type:'File',required:'None',constraints:{maxSizeInKB:4096}},{LogicalName:'exp_receipt',AttributeType:'Virtual',AttributeTypeName:{Value:'FileType'},RequiredLevel:{Value:'None'},MaxSizeInKB:4096}],
    [{name:'exp_date',type:'DateTime',required:'None',constraints:{format:'DateOnly',dateTimeBehavior:'DateOnly'}},{LogicalName:'exp_date',AttributeType:'DateTime',RequiredLevel:{Value:'None'},Format:'DateOnly',DateTimeBehavior:{Value:'DateOnly'}}],
  ];
  for(const [column,row] of cases)expect(()=>compareColumn(column,row)).not.toThrow();
  expect(()=>compareColumn(cases[1][0],{...cases[1][1],Targets:['team']})).toThrow();expect(()=>compareColumn(cases[2][0],{...cases[2][1],OptionSet:{Options:[{Value:1}]}})).toThrow();expect(()=>compareColumn({...cases[2][0],constraints:{options:[1,2,3]}},cases[2][1],true)).not.toThrow();
  expect(()=>compareColumn(cases[2][0],{...cases[2][1],OptionSet:{Options:[{Value:1},{Value:2}],'Options@odata.nextLink':'more'}})).toThrow();
  expect(()=>compareColumn(cases[4][0],{...cases[4][1],DateTimeBehavior:{Value:'UserLocal'}})).toThrow();
});
it('uses documented typed metadata requests and denies changed identities, missing IDs and ambiguous base rows',async()=>{
  const request=vi.fn<Request>(async()=>actual);await verifyColumns([title],'exp_report',[actual],request);
  expect(request.mock.calls[0][0]).toBe('GET');expect(request.mock.calls[0][1]).toContain(`/Attributes(${id})/Microsoft.Dynamics.CRM.StringAttributeMetadata?`);expect(request.mock.calls[0][1]).toContain('MaxLength,Format');
  await expect(verifyColumns([title],'exp_report',[{...actual,MetadataId:undefined}],request)).rejects.toThrow('metadata ID');
  await expect(verifyColumns([title],'exp_report',[actual,actual],request)).rejects.toThrow('ambiguous');
  await expect(verifyColumns([title,title],'exp_report',[actual],request)).rejects.toThrow('Duplicate');
  await expect(verifyColumns([title],'exp_report',[],request)).rejects.toThrow('Missing');await verifyColumns([title],'exp_report',[],request,true);
  await expect(verifyColumns([title],'exp_report',[actual],async()=>({...actual,MetadataId:'22222222-2222-4222-8222-222222222222'}))).rejects.toThrow('identity');
});
