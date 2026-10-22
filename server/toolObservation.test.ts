import {expect,it} from 'vitest';
import {toolObservation} from './toolObservation.ts';
it.each([{isError:true},JSON.stringify({isError:true,content:[{type:'text',text:'denied'}]}),{error:'denied'},{content:[{type:'text',text:JSON.stringify({error:'denied'})}]}])('retains explicit provider failures across native envelopes: %j',raw=>{
  expect(toolObservation(raw)).toEqual({data:null,outcome:'failure'});
});
it('distinguishes explicit success from transport completion and malformed output',()=>{
  expect(toolObservation({isError:false,structuredContent:{caller:'maker'}})).toEqual({data:{caller:'maker'},outcome:'success'});
  expect(toolObservation({caller:'maker'}).outcome).toBe('unknown');
  expect(toolObservation('Not JSON')).toEqual({data:null,outcome:'unknown'});
});
