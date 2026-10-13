import {expect,it} from 'vitest';
import {allowedRuntime,runtimeModelError} from './runtimePolicy.ts';
import {CLIS,commandFor} from '../server/clis.ts';
it('exposes only the three approved runtimes and never resolves retired binaries',()=>{
  expect(CLIS.map(cli=>cli.id).sort()).toEqual(['codex','gemini','opencode']);
  for(const cli of ['claude','copilot'] as const){expect(allowedRuntime(cli)).toBe(false);expect(commandFor(cli)).toBeNull();}
});
it.each(['anthropic/claude-sonnet','opencode/claude-opus','claude','sonnet','opus','haiku'])('rejects Claude model aliases in every approved runtime: %s',model=>{
  for(const cli of ['codex','gemini','opencode'] as const)expect(runtimeModelError(cli,model)).toContain('not permitted');
});
it('requires an approved explicit OpenCode provider even when local configuration has a default',()=>{
  for(const model of ['', 'opencode/big-pickle','anthropic/claude'])expect(runtimeModelError('opencode',model)).not.toBeNull();
  expect(runtimeModelError('opencode','openai/gpt-example')).toBeNull();
  expect(runtimeModelError('opencode','google/gemini-example')).toBeNull();
});
