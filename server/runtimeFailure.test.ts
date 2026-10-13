import {expect,it} from 'vitest';
import {copilotUnavailableModel} from './runtimeFailure.ts';
const native='Error: Model "gpt-6.1-sol" from --model flag is not available.';
it('matches only the explicitly requested model, including persisted native wrapper',()=>{
  expect(copilotUnavailableModel(native,'gpt-6.1-sol')).toBe(true);
  expect(copilotUnavailableModel('GitHub Copilot CLI exited with code 1. '+native,'gpt-6.1-sol')).toBe(true);
});
it.each([['',native],['another-model',native],['gpt-6.1-sol','Model is at capacity'],['gpt-6.1-sol','Please review: '+native],['gpt-6.1-sol','Error: authentication required'],['gpt-6.1-sol',native+' quoted task']])('does not hold unrelated or quoted failures: %#',(model,text)=>expect(copilotUnavailableModel(text,model)).toBe(false));
