import {expect, it} from 'vitest';
import {capabilityBlocker} from './capabilityChecks.ts';
const check = {id: 'auth', category: 'authentication', passed: true, detail: 'Observed current identity', remedy: 'Sign in to the target'};
it('admits only nonempty ready evidence whose checks passed', () => {
  expect(capabilityBlocker({status: 'ready', checks: [check]})).toBeNull();
  for (const result of [{status: 'ready' as const, checks: []}, {status: 'blocked' as const, checks: []}, {status: 'blocked' as const, checks: [check]}, {status: 'ready' as const, checks: [{...check, passed: false}]}]) {
    expect(capabilityBlocker(result)).toBeTypeOf('string'); expect(capabilityBlocker(result)).not.toBe('');
  }
  expect(capabilityBlocker({status: 'blocked', checks: [{...check, passed: false}]})).toBe('auth: Sign in to the target');
});
