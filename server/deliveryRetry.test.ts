import {describe,it,expect} from 'vitest';
import {nextPreflightRetry,preflightContext,preflightDeferred,preflightRetrySchema} from './deliveryRetry.ts';

describe('delivery preflight retry policy',()=>{
  it('backs off, persists a finite circuit and rejects inconsistent schedules',()=>{
    let now=Date.parse('2026-10-13T12:00:00Z'),retry;
    const context=preflightContext(undefined,'https://development.crm4.dynamics.com');
    for(let failure=1;failure<=6;failure++){
      retry=nextPreflightRetry(retry,context,now);expect(retry.failures).toBe(failure);expect(preflightRetrySchema.safeParse(retry).success).toBe(true);
      expect(preflightDeferred(retry,context,now)).toBe(true);
      if(retry.nextAttemptAt){const due=Date.parse(retry.nextAttemptAt);expect(due-now).toBe(120_000*2**(failure-1));expect(preflightDeferred(retry,context,due-1)).toBe(true);expect(preflightDeferred(retry,context,due)).toBe(false);now=due;}
    }
    expect(retry!.nextAttemptAt).toBeNull();expect(preflightDeferred(retry,context,now+86400000)).toBe(true);
    expect(preflightRetrySchema.safeParse({...retry,failures:7}).success).toBe(false);
    expect(preflightRetrySchema.safeParse({...retry,failures:1}).success).toBe(false);
    expect(preflightRetrySchema.safeParse({...nextPreflightRetry(undefined,context,now),nextAttemptAt:new Date(now).toISOString()}).success).toBe(false);
  });
  it('allows a changed target/approved contract without treating changed error text as a reset',()=>{
    const first=preflightContext(undefined,'https://one.crm4.dynamics.com'),next=preflightContext(undefined,'https://two.crm4.dynamics.com');
    const retry=nextPreflightRetry(undefined,first);expect(preflightDeferred(retry,next)).toBe(false);expect(nextPreflightRetry(retry,next).failures).toBe(1);expect(preflightDeferred(undefined,first)).toBe(false);
  });
});
