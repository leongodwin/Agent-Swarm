import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';
import type {DeliveryRun} from '../shared/delivery';
test('shows pending quality evidence separately from individual independent QA decisions',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');const snapshot=await(await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  const checks=['compile','package','runtime','access','recovery','doc-user','doc-administrator','doc-operations','doc-architecture'].map((checkId,i)=>({checkId,kind:(['compile','package','runtime','access','recovery','documentation','documentation','documentation','documentation'] as const)[i],evidenceSha256:'a'.repeat(64)}));
  const run:DeliveryRun={id:'quality-run',repoId:snapshot.repos[0].id,head:'b'.repeat(40),environmentUrl:'https://synthetic.crm.dynamics.com',phase:'reviewing',startedAt:new Date().toISOString(),appUrls:[],evidence:['quality-evidence.json'],log:[],qualityEvidence:{schemaVersion:1,contractHash:'c'.repeat(64),artifactSha256:'d'.repeat(64),evidenceFile:'quality-evidence.json',observedAfter:new Date().toISOString(),checks}};
  await page.route(/\/api\/delivery(?:\?|$)/,route=>route.fulfill({json:{availability:'ready',policy:null,running:false,runs:[run],releases:[],blockers:[],revision:0,message:'Synthetic QA display fixture'}}));
  await page.goto('/?quality=low');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.evaluate(()=>{const store=(window as any).__swarmStore;store.setState({demo:false});store.getState().openOverlay({kind:'alm-kiosk'});});
  const panel=page.getByRole('region',{name:'QA and documentation evidence'});await expect(panel).toContainText('9 evidence checks await individual QA assessment');await expect(panel).toContainText('Documentation presence alone does not establish quality');
  run.qualityReview={reviewer:'independent-qa',reviewedAt:new Date().toISOString(),evidenceHash:'e'.repeat(64),contractHash:'c'.repeat(64),decisions:checks.map(c=>({checkId:c.checkId,evidenceSha256:c.evidenceSha256,decision:'approved',notes:`Inspected the actual synthetic ${c.checkId} artifact and its stated limitations.`}))};
  await expect(panel).toContainText('All 9 checks independently reviewed by independent-qa');await panel.getByText('Per-check QA decisions',{exact:true}).click();await expect(panel).toContainText('doc-user: approved');await expect(panel).toContainText('actual synthetic doc-user artifact');
  await page.setViewportSize({width:390,height:844});await expect(panel).toBeVisible();expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
