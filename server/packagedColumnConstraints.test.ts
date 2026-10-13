import {expect,it} from 'vitest';
import {packagedColumnConstraints as extract,comparePackagedConstraints as compare} from './packagedColumnConstraints.ts';

it('distinguishes character limits from byte lengths and compares explicit limits',()=>{
  const facts=extract({Type:'nvarchar',MaxLength:'200',Length:'400'});
  expect(facts.values).toEqual({maxLength:200});expect(compare(facts,{maxLength:200}).status).toBe('matched');
  for(const expected of [undefined,{maxLength:400},{maxLength:100}])expect(compare(facts,expected).status).toBe('blocked');
  expect(compare(extract({Type:'nvarchar',Length:'400'}),{maxLength:200}).status).toBe('unavailable');
});
it('pins numeric bounds, precision and file limits rather than approving expansions in a package',()=>{
  const numeric=extract({Type:'money',MinValue:'-1.0e2',MaxValue:'1000',Accuracy:'2'});
  expect(compare(numeric,{minValue:-100,maxValue:1000,precision:2}).status).toBe('matched');
  for(const value of [{minValue:-100,maxValue:2000,precision:2},{minValue:0,maxValue:1000,precision:2},{minValue:-100,maxValue:1000,precision:3}])expect(compare(numeric,value).status).toBe('blocked');
  expect(compare(extract({Type:'file',MaxSizeInKB:'1024'}),{maxSizeInKB:1024}).status).toBe('matched');
});
it.each([{Type:'nvarchar',MaxLength:'NaN'},{Type:'nvarchar',MaxLength:'0'},{Type:'nvarchar',MaxLength:['100','200']},{Type:'int',MinValue:'0.5'},{Type:'int',MaxValue:'2147483648'},{Type:'money',MinValue:'2',MaxValue:'1'},{Type:'decimal',Accuracy:'11'},{Type:'file',MaxSizeInKB:'Infinity'},{Type:'bit',MaxLength:'100'},{Type:'money',AccuracySource:'2'},{ValidForReadApi:'true'},{SourceType:'3'}])('keeps malformed or contradictory source constraints unverified: %j',raw=>{
  const facts=extract(raw);expect(facts.unavailable.length).toBeGreaterThan(0);expect(compare(facts,facts.values).status).toBe('unavailable');
});
it('verifies individually observed access flags, including false and zero values',()=>{
  const facts=extract({ValidForCreateApi:'1',ValidForReadApi:'1',ValidForUpdateApi:'0',IsSecured:'0',IsLogical:'0',SourceType:'0'});
  const access={create:true,read:true,update:false,secured:false,logical:false,sourceType:0};
  expect(compare(facts,{access}).status).toBe('matched');expect(compare(facts,{access:{...access,secured:true}}).status).toBe('blocked');expect(compare(facts,{}).status).toBe('blocked');
  expect(compare(extract({IsSecured:'0'}),{access}).status).toBe('unavailable');
});
it('checks unordered choice sets and rejects duplicate, oversized and unsupported source values',()=>{
  const choice=(values:string[])=>({Type:'picklist',optionset:{options:{option:values.map(value=>({'@_value':value}))}}});
  expect(compare(extract(choice(['2','1'])),{options:[1,2]}).status).toBe('matched');
  expect(compare(extract(choice(['2','1'])),{options:[1]}).status).toBe('blocked');
  for(const raw of [choice(['1','01']),choice(['2147483648']),choice(Array(10001).fill('1')),{Type:'picklist',optionset:{}}])expect(extract(raw).unavailable.length).toBeGreaterThan(0);
});
it('does not infer format, lookup targets or missing source defaults',()=>{
  expect(compare(extract({Type:'nvarchar',Format:'text'}),{format:'Text'}).status).toBe('unavailable');
  expect(compare(extract({Type:'lookup',LookupTypes:{LookupType:{'#text':'8'}}}),{targets:['systemuser']}).status).toBe('unavailable');
  expect(compare(extract({Type:'money'}),{precisionSource:2}).status).toBe('unavailable');
});
