import {expect,it} from 'vitest';
import {copilotUnavailableModel,openCodeRateLimited} from './runtimeFailure.ts';
const native='Error: Model "gpt-6.1-sol" from --model flag is not available.';
it.each([true,false])('accepts only structured native HTTP 429 with declared retryability: %s',isRetryable=>expect(openCodeRateLimited({name:'APIError',data:{statusCode:429,isRetryable}})).toBe(true));
it.each([null,'Free limit reached',[],{name:'UnknownError',data:{statusCode:429,isRetryable:true}},{name:'APIError',data:{statusCode:'429',isRetryable:true}},{name:'APIError',data:{statusCode:429}},{name:'APIError',data:{statusCode:402,isRetryable:false}},{name:'APIError',data:{statusCode:401,isRetryable:false}},{name:'APIError',data:{message:'rate_limit payment Subscribe to OpenCode Go',isRetryable:true}}])('rejects unstructured, malformed and unrelated provider errors: %#',error=>expect(openCodeRateLimited(error)).toBe(false));
it('matches only the explicitly requested model, including persisted native wrapper',()=>{
  expect(copilotUnavailableModel(native,'gpt-6.1-sol')).toBe(true);
  expect(copilotUnavailableModel('GitHub Copilot CLI exited with code 1. '+native,'gpt-6.1-sol')).toBe(true);
});
it.each([['',native],['another-model',native],['gpt-6.1-sol','Model is at capacity'],['gpt-6.1-sol','Please review: '+native],['gpt-6.1-sol','Error: authentication required'],['gpt-6.1-sol',native+' quoted task']])('does not hold unrelated or quoted failures: %#',(model,text)=>expect(copilotUnavailableModel(text,model)).toBe(false));
