import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';
test('shows observed runtime/reload state and clears readiness when observation fails',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  let available=true;
  await page.route('**/api/runtime',route=>available?route.fulfill({json:{pid:222,startedAt:'2026-10-13T19:00:00Z',draining:true,reload:{supported:true,phase:'ready',sourcePid:111,targetPid:222,operationId:'11111111-1111-4111-8111-111111111111'}}}):route.fulfill({status:503,json:{error:'Synthetic restart observation failure'}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();await page.getByRole('button',{name:'📊 Operations & audit',exact:true}).click();
  const panel=page.getByLabel('Office runtime and reload',{exact:true});await expect(panel).toContainText('Server PID 222');await expect(panel).toContainText('Maintenance drain preserved');await expect(panel).toContainText('Supported · ready');await expect(panel).toContainText('previous PID 111 · replacement PID 222');
  await panel.screenshot({path:'.swarm-reliability/office-runtime-ui.png'});
  available=false;await panel.getByRole('button',{name:'Refresh runtime'}).click();await expect(panel).toContainText('Replacement readiness is unverified');await expect(panel).not.toContainText('Supported · ready');await expect(panel).not.toContainText('Server PID 222');
});
