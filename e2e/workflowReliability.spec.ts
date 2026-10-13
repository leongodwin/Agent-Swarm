import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';
test('shows attempt denominator and failed rerun history without presenting incomplete data as zero failures',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  let available=true;
  await page.route('**/api/repos/*/reliability',route=>route.fulfill({json:{status:available?'observed':'unavailable',scope:'github-actions-run-creation-window',repo:snapshot.repos[0].fullName,observedAt:'2026-10-13T12:00:00Z',window:{from:'2026-09-13T12:00:00Z',to:'2026-10-13T12:00:00Z'},complete:available,targetPercent:99.5,reason:available?'Other CI providers and tenant integration runs are not included; this observation does not prove release readiness.':'History incomplete; reliability is unverified',completed:available?2:null,successful:available?1:null,unsuccessful:available?1:null,active:available?0:null,rerunAttempts:available?1:null,successPercent:available?50:null,observedMeetsTarget:available?false:null,failures:available?[{runId:1,attempt:1,name:'CI',conclusion:'failure',url:'https://github.com/owner/project/actions/runs/1/attempts/1',headSha:'a'.repeat(40)}]:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();await page.getByRole('button',{name:'📊 Operations & audit',exact:true}).click();
  const panel=page.getByLabel('CI reliability history',{exact:true});await expect(panel).toContainText('50.0000%');await expect(panel).toContainText('2 completed · 1 successful · 1 unsuccessful');await expect(panel).toContainText('Observed window below target');await expect(panel.getByRole('link',{name:'CI · attempt 1'})).toBeVisible();
  await page.screenshot({path:'.swarm-reliability/workflow-reliability-ui.png'});
  available=false;await panel.getByRole('button',{name:'Refresh CI history'}).click();await expect(panel).toContainText('History incomplete');await expect(panel).not.toContainText('0 unsuccessful');await expect(panel).not.toContainText('2 completed');
});
