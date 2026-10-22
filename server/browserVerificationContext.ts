import type {ReleasePlan} from './releasePlan.ts';
import {z} from 'zod';
import type {AcceptedHeadlessReport} from './headlessAcceptedReport.ts';
export interface BrowserVerificationContext {runId:string;repoId?:string;environmentUrl?:string;acceptedHeadlessReport?:()=>Promise<AcceptedHeadlessReport>;assertOwned?:()=>Promise<void>;scenarioStarted?:(name:string,viewportWidth:number)=>Promise<void>;scenarioCompleted?:(name:string,viewportWidth:number)=>Promise<void>}
export function verificationNavigationUrl(plan:ReleasePlan,context?:BrowserVerificationContext){
 if(!plan.verification.functionalShowcase)return plan.verification.baseUrl;
 if(!context)throw Error('Functional showcase requires runner-owned execution correlation');
 z.uuid().parse(context.runId);const url=new URL(plan.verification.baseUrl);
 if(url.searchParams.has('qaRunId'))throw Error('Functional correlation cannot replace an existing application parameter');
 url.searchParams.set('qaRunId',context.runId);return url.href;
}
export function verificationScenario(plan:ReleasePlan,context:BrowserVerificationContext|undefined,scenario:ReleasePlan['verification']['scenarios'][number]){
 if(!plan.verification.functionalShowcase)return scenario;
 const base=new URL(verificationNavigationUrl(plan,context));
 return {...scenario,steps:scenario.steps.map(step=>{if(step.action!=='goto')return step;const url=new URL(step.path,base);if(url.origin!==base.origin||url.pathname!==base.pathname||url.searchParams.has('qaRunId')&&url.searchParams.get('qaRunId')!==context!.runId)throw Error('Functional navigation must retain the exact approved app and runner correlation');url.searchParams.set('qaRunId',context!.runId);return {...step,path:url.pathname+url.search+url.hash};})};
}
