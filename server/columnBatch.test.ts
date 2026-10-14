import {expect,it,vi} from 'vitest';
import {verifyColumns,type ColumnContract} from './columnContracts.ts';
import type {Request} from './targetOperations.ts';

function fixture(count=2){
  const columns:ColumnContract[]=Array.from({length:count},(_,index)=>({name:`exp_field${index}`,type:'String',required:'None',constraints:{maxLength:100}}));
  const rows=columns.map((column,index)=>({LogicalName:column.name,MetadataId:`11111111-1111-4111-8111-${String(index).padStart(12,'0')}`,AttributeType:'String',RequiredLevel:{Value:'None'},MaxLength:100}));
  const request=vi.fn<Request>(async(_method,resource)=>{
    const ids=new URL('https://metadata.test/'+resource).searchParams.get('$filter');
    return ids?{value:rows.filter(row=>ids.includes(row.MetadataId)).reverse()}:rows.find(row=>resource.includes(row.MetadataId));
  });
  return {columns,rows,request,verify:(migration=false)=>verifyColumns(columns,'exp_report',rows,request,migration)};
}
it('groups constraints by typed metadata, joins exact identities and accepts response reordering',async()=>{
  const f=fixture();await f.verify();expect(f.request).toHaveBeenCalledOnce();
  const [method,resource]=f.request.mock.calls[0];expect(method).toBe('GET');expect(resource).toContain('/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata?');
  const query=new URL('https://metadata.test/'+resource).searchParams;expect(query.get('$filter')).toBe(f.rows.map(row=>`MetadataId eq ${row.MetadataId}`).join(' or '));expect(query.has('$top')).toBe(false);
  expect(resource).not.toContain('private-row-value');
});
it('caps each collection at twenty exact IDs rather than retrieving all table metadata',async()=>{
  const f=fixture(100);await f.verify();expect(f.request).toHaveBeenCalledTimes(5);
  for(const [,resource] of f.request.mock.calls){expect(resource.length).toBeLessThan(4000);expect(new URL('https://metadata.test/'+resource).searchParams.get('$filter')!.split(' or ')).toHaveLength(20);}
});
it.each(['missing','extra','duplicate-name','duplicate-id','changed-id','swapped-id','wrong-type','wrong-required','wrong-constraint','pagination','missing-id'])('denies %s collection without an individual retry',async mode=>{
  const f=fixture();const rows=structuredClone(f.rows);let output:unknown={value:rows};
  if(mode==='missing')rows.pop();if(mode==='extra')rows.push({...rows[0],LogicalName:'exp_other'});
  if(mode==='duplicate-name')rows[1].LogicalName=rows[0].LogicalName;
  if(mode==='duplicate-id')rows[1].MetadataId=rows[0].MetadataId;
  if(mode==='changed-id')rows[0].MetadataId='22222222-2222-4222-8222-222222222222';
  if(mode==='swapped-id')[rows[0].MetadataId,rows[1].MetadataId]=[rows[1].MetadataId,rows[0].MetadataId];
  if(mode==='wrong-type')rows[1].AttributeType='Memo';if(mode==='wrong-required')rows[1].RequiredLevel.Value='ApplicationRequired';
  if(mode==='wrong-constraint')rows[1].MaxLength=99;if(mode==='pagination')output={value:rows,'@odata.nextLink':'https://unapproved.test'};
  if(mode==='missing-id')delete (rows[0] as any).MetadataId;
  f.request.mockResolvedValue(output);await expect(f.verify()).rejects.toThrow();expect(f.request).toHaveBeenCalledOnce();
});
it('keeps migration expansion rules and stops before requests when base columns are incompatible',async()=>{
  const f=fixture();for(const column of f.columns)column.constraints={maxLength:200};await f.verify(true);await expect(f.verify()).rejects.toThrow('MaxLength');
  const invalid=fixture();invalid.rows[1].AttributeType='Memo';await expect(invalid.verify()).rejects.toThrow('mismatch');expect(invalid.request).not.toHaveBeenCalled();
});
it('separates types, retains singleton paths and skips absent additive columns only before import',async()=>{
  const f=fixture();f.columns[1]={name:'exp_field1',type:'Memo',required:'None',constraints:{maxLength:100}};f.rows[1].AttributeType='Memo';
  await f.verify();expect(f.request).toHaveBeenCalledTimes(2);expect(f.request.mock.calls[1][1]).toContain('/Microsoft.Dynamics.CRM.MemoAttributeMetadata?');
  const absent=fixture();await verifyColumns(absent.columns,'exp_report',[absent.rows[0]],absent.request,true);expect(absent.request).toHaveBeenCalledOnce();
  await expect(verifyColumns(absent.columns,'exp_report',[absent.rows[0]],absent.request)).rejects.toThrow('Missing');
});
it('selects only choice values and compares each column option set independently',async()=>{
  const f=fixture();for(const column of f.columns){column.type='Picklist';column.constraints={options:[1,2]};}
  const rows=f.rows.map(row=>({...row,AttributeType:'Picklist',OptionSet:{Options:[{Value:2},{Value:1}]}}));
  f.request.mockResolvedValue({value:rows});await verifyColumns(f.columns,'exp_report',rows,f.request);expect(f.request.mock.calls[0][1]).toContain('&$expand=OptionSet($select=Options)');
  rows[1].OptionSet.Options.pop();await expect(verifyColumns(f.columns,'exp_report',rows,f.request)).rejects.toThrow('Choice');
});
