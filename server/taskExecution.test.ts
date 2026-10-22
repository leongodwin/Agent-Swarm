import {expect,it,vi} from 'vitest';
import {mergedTaskEvidence,verifyTaskInputs} from './taskExecution.ts';
import type {PrDetails} from './github.ts';
import {git} from './exec.ts';
vi.mock('./exec.ts',()=>({git:vi.fn(async()=> '')}));
const head='a'.repeat(40),merge='b'.repeat(40);
const pr={number:7,baseRefName:'main',state:'MERGED',headSha:head,mergeCommitSha:merge,closesIssues:[11]} as PrDetails;
it('requires a merged exact QA head with linked issue and observable merge commit',()=>{
  expect(mergedTaskEvidence(pr,11,head,'main')).toEqual({prNumber:7,headSha:head,mergeCommitSha:merge});
  for(const patch of [{baseRefName:'feature'},{state:'OPEN'},{headSha:'c'.repeat(40)},{mergeCommitSha:null},{mergeCommitSha:'--bad'},{closesIssues:[]}])expect(()=>mergedTaskEvidence({...pr,...patch} as PrDetails,11,head,'main')).toThrow('must be merged');
});
it('verifies every accepted prerequisite is an ancestor before permitting authoring',async()=>{
  vi.mocked(git).mockClear();await verifyTaskInputs('synthetic-desk',[head,merge]);expect(git).toHaveBeenNthCalledWith(1,['merge-base','--is-ancestor',head,'HEAD'],{cwd:'synthetic-desk'});expect(git).toHaveBeenCalledTimes(2);
  vi.mocked(git).mockRejectedValueOnce(new Error('not an ancestor'));await expect(verifyTaskInputs('synthetic-desk',[merge])).rejects.toThrow('absent from this checkout');
  await expect(verifyTaskInputs('synthetic-desk',['--bad'])).rejects.toThrow('Invalid prerequisite');
});
