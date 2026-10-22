import {functionalFixture} from './testFixtures/functionalShowcase.ts';
import {verificationNavigationUrl,verificationScenario} from './browserVerificationContext.ts';
import { expect, it } from 'vitest';
import { releasePlanSchema, acceptanceScope } from './releasePlan.ts';
const states = ['loading', 'empty', 'validation', 'failure', 'recovery', 'success'];
const categories = ['journey', 'journey', 'error-handling', 'authorization', 'persistence', 'journey'];
function plan() { return { name: 'Scoped release', owner: 'author', qaOwner: 'qa', requiredIssues: [1], components: ['app'], acceptanceCriteria: ['End-to-end task'],
  quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['worker'] },
  verification: { baseUrl: 'https://app.example.test', identities: [{ id: 'leon', expectedUser: 'leon@example.test', userSelector: '#user' }],
    scenarios: states.map((state, i) => ({ name: state, states: [state], category: categories[i], identity: 'leon', criterion: 0,
      steps: [{ action: 'press', selector: '#result', key: 'Tab' }, ...(i === 4 ? [{ action: 'reload' }] : []), { action: 'text', selector: '#result', contains: 'Expected result' }] })) } }; }
it('allows one identity only for explicitly scoped development validation and exposes its limitations', () => {
  const input = plan(); expect(releasePlanSchema.safeParse(input).success).toBe(false);
  expect(releasePlanSchema.safeParse({ ...input, acceptanceProfile: 'production' }).success).toBe(false);
  const parsed = releasePlanSchema.parse({ ...input, acceptanceProfile: 'functional-development' });
  expect(acceptanceScope(parsed).limitations.join()).toContain('permission isolation are not certified');
});
it('keeps old strict plans and their serialized shape unchanged', () => {
  const input = plan(); input.verification.identities.push({ id: 'approver', expectedUser: 'approver@example.test', userSelector: '#user' });
  input.verification.scenarios[1].identity = 'approver';
  expect(releasePlanSchema.parse(input)).toEqual(input);
  expect(acceptanceScope(releasePlanSchema.parse(input)).profile).toBe('production');
});
it('never relaxes independent review, criteria or distinct account declarations for development', () => {
  const input = { ...plan(), acceptanceProfile: 'functional-development' };
  expect(releasePlanSchema.safeParse({ ...input, qaOwner: input.owner }).success).toBe(false);
  expect(releasePlanSchema.safeParse({ ...input, acceptanceCriteria: ['Task', 'Uncovered criterion'] }).success).toBe(false);
  input.verification.identities.push({ id: 'another-id', expectedUser: 'LEON@example.test', userSelector: '#user' });
  expect(releasePlanSchema.safeParse(input).success).toBe(false);
});
it('requires distinct live conversation cases, published channels and multiple asserted turns for Copilot', () => {
  const input = { ...plan(), acceptanceProfile: 'functional-development', verification: { ...plan().verification,
    scenarios: plan().verification.scenarios.map((scenario) => ({ ...scenario, steps: [{ action: 'fill', selector: '#prompt', value: 'Synthetic test question' }, ...scenario.steps,
      { action: 'fill', selector: '#prompt', value: 'Follow-up question' }, { action: 'text', selector: '#reply', contains: 'Expected follow-up' }] })),
    copilotChecks: [{ component: 'agent', channelUrl: 'https://app.example.test', cases: ['grounding', 'fallback', 'tool-action', 'authorization', 'safety', 'multi-turn'].map((kind, i) => ({ kind, scenario: states[i] })) }] } };
  expect(releasePlanSchema.safeParse(input).success).toBe(true);
  input.verification.copilotChecks[0].cases[5].scenario = states[0];
  expect(releasePlanSchema.safeParse(input).success).toBe(false);
});
function functionalPlan(){
 const f=functionalFixture(),input=plan();return{...input,acceptanceProfile:'functional-development',quality:{maxTaskDurationMs:120000,maxVerificationDurationMs:1800000,maxSeriousAccessibilityIssues:0},verification:{browserSession:'connected-extension',baseUrl:'https://apps.powerapps.com/play/e/Default-'+f.tenantId+'/a/'+f.flowId,functionalShowcase:f.config,identities:[{id:'writer',expectedUser:'leon@example.test',userSelector:'#user'},{id:'restricted',expectedUser:'leon@example.test',userSelector:'#user'}],scenarios:[['Loading','loading','journey'],['Empty','empty','journey'],['Invalid','validation','error-handling'],['Success','success','journey'],['Duplicate','success','error-handling'],['Failure','failure','error-handling'],['Recovery','recovery','persistence'],[f.config.rejection.testName,'failure','authorization']].map(([name,state,category])=>({name,states:[state],category,identity:category==='authorization'?'restricted':'writer',criterion:0,steps:[{action:'press',selector:'#result',key:'Tab'},...(category==='persistence'?[{action:'reload'}]:[]),{action:'text',selector:'#result',contains:'Observed actual state'}]}))}};
}
it('admits only explicit functional showcase limits with ordered independent positive and rejection cases',()=>{
 const parsed=releasePlanSchema.parse(functionalPlan());expect(acceptanceScope(parsed).limitations.join(' ')).toContain('complete historical absence');expect(acceptanceScope(parsed).limitations.join(' ')).toContain('solution rollback');
 for(const mode of ['production','suite-missing','suite-short','target','old-native','missing-recovery','duplicate-order']){const value:any=functionalPlan();if(mode==='production')value.acceptanceProfile='production';if(mode==='suite-missing')delete value.quality.maxVerificationDurationMs;if(mode==='suite-short')value.quality.maxVerificationDurationMs=1000;if(mode==='target')value.verification.functionalShowcase.recovery.target={...value.verification.functionalShowcase.recovery.target,listId:functionalFixture().flowId};if(mode==='old-native')value.verification.nativeDeniedChecks=[];if(mode==='missing-recovery')value.verification.scenarios=value.verification.scenarios.filter((s:any)=>s.name!=='Recovery');if(mode==='duplicate-order')value.verification.scenarios.reverse();expect(releasePlanSchema.safeParse(value).success,mode).toBe(false);}
});
it('binds only a runner UUID to the same approved application and retains it on subsequent navigation',()=>{
 const parsed=releasePlanSchema.parse(functionalPlan()),f=functionalFixture(),url=new URL(verificationNavigationUrl(parsed,{runId:f.context.runId}));expect(url.searchParams.get('qaRunId')).toBe(f.context.runId);expect(()=>verificationNavigationUrl(parsed)).toThrow('runner-owned');expect(()=>verificationNavigationUrl(parsed,{runId:'not-a-run'})).toThrow();const scenario=parsed.verification.scenarios[0],withGoto={...scenario,steps:[{action:'goto' as const,path:url.pathname},...scenario.steps]};expect(verificationScenario(parsed,{runId:f.context.runId},withGoto).steps[0]).toMatchObject({path:url.pathname+'?qaRunId='+f.context.runId});expect(()=>verificationScenario(parsed,{runId:f.context.runId},{...withGoto,steps:[{action:'goto',path:'/another-app'}]})).toThrow('exact approved app');
});
it.each(['valid','missing-record','foreign-id','foreign-hash'])('binds an existing-tenant history policy to the exact reviewed record: %s',mode=>{
 const recordId='11111111-1111-4111-8111-111111111111',recordSha256='a'.repeat(64),base=plan();
 const checks=['dry-run','recipient-denied','attachment-fallback','retry-recovery','retry-exhaustion'].map(m=>({name:'Case '+m,identity:'owner',criterion:0,category:m==='recipient-denied'?'authorization':m.includes('retry')||m.includes('attachment')?'error-handling':'journey',mode:m,expectedStatus:m==='recipient-denied'||m==='retry-exhaustion'?'Failed':'Succeeded',assertions:[{pointer:['status'],equals:m}]}));
 const value={...base,deliveryRecord:mode==='missing-record'?undefined:{id:recordId,revision:1,sha256:recordSha256,purpose:'slice'},verification:{baseUrl:base.verification.baseUrl,identities:[],scenarios:[],headlessFlow:{flowId:recordId,identity:{tenantId:recordId,environmentId:recordId,username:'owner@example.test'},definitionSha256:recordSha256,operationScope:'standard-mail-v1',historyPolicy:{kind:'existing-tenant-run-history-v1',recordId:mode==='foreign-id'?'22222222-2222-4222-8222-222222222222':recordId,recordSha256:mode==='foreign-hash'?'b'.repeat(64):recordSha256,ownerId:recordId},contextAction:'Run_context',resultAction:'Verification_result',sendAction:'Send_report',checks}}};
 if(mode==='valid')expect(releasePlanSchema.safeParse(value).success).toBe(true);else expect(()=>releasePlanSchema.parse(value)).toThrow('History policy must bind');
});
