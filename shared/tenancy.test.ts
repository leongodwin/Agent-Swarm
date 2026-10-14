import {expect,it} from 'vitest';
import {currentEnvironment,type TenancyInfo} from './tenancy.ts';
const target={index:1,name:'Synthetic',url:'https://synthetic.crm4.dynamics.com/',user:'user@example.test',active:true};
const info:TenancyInfo={tenantName:'',tenantDomain:'',tenantId:'',user:target.user,environments:[target],status:'connected',isReal:true};
it('selects exactly one current real target and requires explicit opt-in for demo display',()=>{
  expect(currentEnvironment(info)).toEqual(target);const demo={...info,isReal:false,status:'demo' as const};expect(currentEnvironment(demo)).toBeUndefined();expect(currentEnvironment(demo,true)).toEqual(target);
});
it.each(['stale','disconnected',undefined] as const)('does not promote retained active rows when discovery is %s',status=>{
  expect(currentEnvironment({...info,status})).toBeUndefined();expect(currentEnvironment({...info,status},true)).toBeUndefined();
});
it('rejects missing and ambiguous active rows rather than falling back to the first listed profile',()=>{
  for(const environments of [[],[{...target,active:false}],[target,{...target,index:2}]])expect(currentEnvironment({...info,environments})).toBeUndefined();
  expect(currentEnvironment({...info,isReal:false})).toBeUndefined();expect(currentEnvironment(null)).toBeUndefined();expect(currentEnvironment(undefined)).toBeUndefined();
});
it.each(['http://synthetic.crm4.dynamics.com/','https://user:secret@synthetic.crm4.dynamics.com/','https://synthetic.crm4.dynamics.com:444/','https://synthetic.crm4.dynamics.com/path','https://synthetic.crm4.dynamics.com/?token=value','https://synthetic.crm4.dynamics.com/#fragment','invalid'])('rejects an unsafe current organization root: %s',url=>{
  expect(currentEnvironment({...info,environments:[{...target,url}]})).toBeUndefined();
});
