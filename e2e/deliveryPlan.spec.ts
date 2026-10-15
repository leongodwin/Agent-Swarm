import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';
import type {DeliveryRecord} from '../shared/deliveryRecord';

test('shows the shared outcome, evidence blockers and independent gates, then clears stale data on failure',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  const record:DeliveryRecord={schemaVersion:1,id:'11111111-1111-4111-8111-111111111111',repoId:snapshot.repos[0].id,revision:2,sha256:'a'.repeat(64),previousSha256:'b'.repeat(64),updatedAt:new Date().toISOString(),updatedBy:'synthetic',content:{
    brief:'Synthetic expense brief',outcome:'Employees submit expenses for approval',successMeasure:'Submission survives reload',users:['Employee','Approver'],scope:['One submission journey'],exclusions:['Payroll'],owner:'dev',qaOwner:'qa',sourceCommit:'c'.repeat(40),environmentUrl:'https://synthetic.crm.dynamics.com',
    requirements:[{id:'submit',description:'Submit a valid expense',acceptance:'Submission survives reload'}],contracts:[],tasks:[{issue:1,stage:'discovery',requirementIds:['submit']}],
    findings:[{id:'authoring',area:'authoring',statement:'Authoring connection has not been verified',status:'unresolved',critical:true,owner:'dev',remedy:'Verify the authoring connection in this session',evidence:[]}],
    slice:{description:'Submit one expense as the employee',requirementIds:['submit'],acceptanceCriteria:['Submission survives reload']}}};
  let unavailable=false;
  record.content.governanceProfile={tenantId:'11111111-1111-4111-8111-111111111111',environmentUrl:record.content.environmentUrl!,audience:'Synthetic pilot audience',subscriptions:[],controls:[{id:'manual-retention',name:'Manual retention review',owner:'qa',scope:'Pilot data',requirement:'required',availability:'available',subscriptionProducts:[],delivery:'manual',verification:'unverified',rationale:'Verify the manual process before delivery',evidence:[]},{id:'auto-label',name:'Automatic sensitivity labelling',owner:'qa',scope:'Pilot data',requirement:'optional',availability:'unavailable',subscriptionProducts:[],delivery:'none',verification:'unverified',rationale:'No entitlement demonstrated; this optional feature does not authorise or block the pilot',evidence:[]}]};
  await page.route('**/api/repos/*/delivery-record',route=>route.fulfill(unavailable?{status:503,json:{error:'Synthetic record storage failure'}}:{json:{record,phase:'discovery',blockers:['Verify the authoring connection in this session (owner: dev)'],demo:false}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();
  await page.getByRole('button',{name:'Delivery plan',exact:true}).click();
  const panel=page.getByRole('region',{name:'Shared delivery plan'});await expect(panel).toContainText('Employees submit expenses for approval');await expect(panel).toContainText('revision 2');
  await expect(panel.getByRole('button',{name:'Request independent design review'})).toBeEnabled();await expect(panel).toContainText('Wider implementation remains held');
  await expect(panel.getByRole('region',{name:'Tenant governance baseline'})).toContainText('Automatic sensitivity labelling · optional');
  await panel.getByText('authoring · 0 observed',{exact:true}).click();await expect(panel).toContainText('Authoring connection has not been verified');
  await page.screenshot({path:'test-results/delivery-plan-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(panel.getByRole('button',{name:'Refresh plan'})).toBeVisible();
  expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await page.screenshot({path:'test-results/delivery-plan-mobile.png',fullPage:true});
  unavailable=true;await panel.getByRole('button',{name:'Refresh plan'}).click();await expect(panel.getByRole('alert')).toContainText('Delivery planning is unavailable');await expect(panel).not.toContainText('Employees submit expenses for approval');await expect(panel).not.toContainText('revision 2');
});
