import type {z} from 'zod';
import type {deliveryManifest} from './delivery.ts';
type DeliveryManifest=z.infer<typeof deliveryManifest>;
import type {ReleasePlan} from './releasePlan.ts';

/** Backend verification is not a waiver for UI, identity or recovery controls. */
export function assertHeadlessDeliveryBinding(manifest:DeliveryManifest,plan:ReleasePlan){
 const flow=plan.verification.headlessFlow;
 if(!flow||manifest.hasUi||plan.acceptanceProfile!=='functional-development'||!manifest.manualDevelopmentGovernance||manifest.recovery.scope!=='headless-owned-development-flow'||!manifest.targetBinding||!manifest.platformIdentity||manifest.targetComponents.filter(c=>c.kind==='cloud-flow').length!==1||manifest.targetComponents.some(c=>!['cloud-flow','connection-reference'].includes(c.kind)))throw Error('Headless verification requires one explicitly bound manual Development flow without UI components');
 for(const key of ['tenantId','username','environmentId'] as const)if(manifest.platformIdentity[key].toLowerCase()!==flow.identity[key].toLowerCase())throw Error('Headless manifest identity differs from the approved flow');
 if(flow.historyPolicy&&flow.historyPolicy.ownerId.toLowerCase()!==manifest.targetBinding.userId.toLowerCase())throw Error('Headless history owner differs from the approved target user');
}

/** One technical release clock, including setup/build/import/recovery/posts.
 * Expiry revokes scheduling; it never asserts cancellation or clears a journal. */
export function headlessReleaseBudget(startedAt:string,controller:AbortController,clock={wall:()=>Date.now(),mono:()=>performance.now()}){
 const maximum=3600000,start=Date.parse(startedAt),wall=clock.wall(),mono=clock.mono(),age=wall-start;
 const invalid=!Number.isFinite(start)||!Number.isFinite(age)||age<0;
 const reason=Error('Headless release deadline expired or clock is invalid; retain unknown operations and do not replay');
 const timer=setTimeout(()=>controller.abort(reason),invalid?0:Math.max(0,maximum-age));timer.unref?.();
 const budget={assert(){controller.signal.throwIfAborted();const elapsed=clock.mono()-mono,current=clock.wall();if(invalid||!Number.isFinite(elapsed)||!Number.isFinite(current)||elapsed<0||current<start||Math.max(current-start,age+elapsed)>=maximum){controller.abort(reason);throw reason;}},snapshot(){budget.assert();const current=clock.wall(),elapsed=clock.mono()-mono;return{schemaVersion:1,method:'runner-headless-release-clock-v1',limitMs:maximum,startedAt,observedAt:new Date(current).toISOString(),elapsedWallMs:current-start,attemptElapsedMonotonicMs:elapsed,boundElapsedMs:Math.max(current-start,age+elapsed),providerCancellationClaimed:false,scope:'Technical runner work; independent QA waiting time excluded'};},close(){clearTimeout(timer);}};
 return budget;
}
