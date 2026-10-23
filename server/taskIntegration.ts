import type {DeliveryRecordContent} from '../shared/deliveryRecord.ts';
import type {ReleasePlan} from './releasePlan.ts';
import {HttpError} from './httpError.ts';
import {headlessChecks} from './headlessFlowVerification.ts';
/** Bind recorded independent integration work to the existing native runner.
 * No command/model/tenant action is dispatched by planning or validation. */
export function assertTaskIntegrationPlan(content:DeliveryRecordContent,plan:ReleasePlan){
 if(!content.taskPlan)return;
 if(content.taskPlan.schemaVersion!==2)throw new HttpError(409,'Migrate legacy task contracts to version 2 with independent integration QA');
 const q=content.taskPlan.integrationQa?.find(q=>q.purpose===plan.deliveryRecord?.purpose);
 function fail(reason:string):never{throw new HttpError(409,'Integration QA contract: '+reason);}
 if(!q||q.owner!==content.qaOwner||plan.qaOwner!==q.owner)fail('assigned independent owner and phase must match');
 if(plan.requiredIssues.length!==q.dependsOn.length||q.dependsOn.some(n=>!plan.requiredIssues.includes(n)))fail('required merged issues differ from the recorded prerequisites');
 if(plan.quality.maxTaskDurationMs>q.maxTaskDurationMs)fail('execution budget exceeds recorded bound');
 if(q.maxVerificationDurationMs!==undefined&&(plan.quality.maxVerificationDurationMs===undefined||plan.quality.maxVerificationDurationMs>q.maxVerificationDurationMs))fail('verification suite deadline missing or exceeds recorded bound');
 if(q.maxVerificationDurationMs===undefined&&plan.quality.maxVerificationDurationMs!==undefined)fail('verification suite deadline requires a reviewed recorded bound');
 const quality=plan.qualityEvidence;if(!quality)fail('missing quality evidence bindings');
 if(quality.checks.length!==q.checkIds.length||q.checkIds.some(id=>!quality.checks.some(c=>c.checkId===id)))fail('quality checks differ from recorded scope');
 const cases=quality.checks.flatMap(c=>'cases'in c?c.cases.map(row=>({...row,checkId:c.checkId})):[]);
 if(cases.length!==q.cases.length||q.cases.some(row=>!cases.some(c=>c.checkId===row.checkId&&c.scenarioId===row.scenarioId&&c.testName===row.testName)))fail('executable scenario mappings differ');
 const functional=plan.verification.functionalShowcase?.rejection;
 if(functional&&!q.cases.some(c=>c.testName===functional.testName&&c.scenarioId===functional.scenarioId&&c.functionalAssertion&&JSON.stringify(c.functionalAssertion)===JSON.stringify(functional.contract)))fail('unrecorded functional rejection scope');
 for(const c of q.cases)if(c.functionalAssertion&&(!functional||functional.testName!==c.testName||functional.scenarioId!==c.scenarioId||JSON.stringify(c.functionalAssertion)!==JSON.stringify(functional.contract)))fail('missing exact functional rejection assertions');
 const executableChecks=plan.verification.headlessFlow?headlessChecks(plan.verification.headlessFlow):plan.verification.scenarios;
 const native=plan.verification.nativeDeniedChecks??[];
 for(const check of native)if(!q.cases.some(c=>c.testName===check.testName&&c.scenarioId===check.scenarioId&&c.nativeAssertion&&JSON.stringify(c.nativeAssertion)===JSON.stringify(check.contract)))fail('unrecorded native denied operation');
 for(const row of q.cases){if(row.nativeAssertion&&!native.some(c=>c.testName===row.testName&&c.scenarioId===row.scenarioId&&JSON.stringify(c.contract)===JSON.stringify(row.nativeAssertion)))fail('missing exact executable native denial assertions');const test=executableChecks.find(test=>test.name===row.testName);if(!test||plan.acceptanceCriteria[test.criterion]!==row.criterion)fail('test or exact acceptance criterion differs');}
}
