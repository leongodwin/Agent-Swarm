import {expect,it,vi} from 'vitest';
import {startSession} from './agentRunner.ts';
import type {SessionOptions} from './agentRunner.ts';
it.each([false,true])('rejects legacy SDK execution including structured planning (%s)',noTools=>{
 const options:SessionOptions={cwd:process.cwd(),prompt:'Synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',noTools};
 const finished=vi.fn();
 expect(()=>startSession(options,{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished})).toThrow('Claude SDK execution is disabled');
 expect(finished).not.toHaveBeenCalled();
});
