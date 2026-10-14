import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentRecovery} from './AgentRecovery';

it('shows eligibility rather than claiming execution, including drain restrictions',()=>{
  const recovery={kind:'preflight' as const,reason:'Authentication unavailable',failures:2,nextAttemptAt:'2026-10-14T12:00:00Z'};
  const before=renderToStaticMarkup(<AgentRecovery recovery={recovery} now={Date.parse('2026-10-14T11:59:59Z')}/>);
  expect(before).toContain('Readiness retry scheduled');expect(before).toContain('2 consecutive readiness failures');expect(before).toContain('Office drain, capacity and readiness checks still apply');
  const due=renderToStaticMarkup(<AgentRecovery recovery={recovery} now={Date.parse(recovery.nextAttemptAt)}/>);
  expect(due).toContain('Readiness retry eligible');expect(due).not.toContain('Readiness retry scheduled');
});
it('shows explicit recovery steps for model and exhausted readiness holds and escapes reasons',()=>{
  const model=renderToStaticMarkup(<AgentRecovery recovery={{kind:'model',reason:'<script>unavailable</script>',nextAttemptAt:null}}/>);
  expect(model).toContain('Update the agent runtime or model');expect(model).not.toContain('<script>');expect(model).not.toContain('consecutive readiness failures');
  const held=renderToStaticMarkup(<AgentRecovery recovery={{kind:'preflight',reason:'Connector unavailable',failures:6,nextAttemptAt:null}}/>);
  expect(held).toContain('Readiness retries held');expect(held).toContain('explicit retry succeeds');expect(held).not.toContain('<time');
});
