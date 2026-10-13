import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';
test('shows quarantined native cleanup and its authoritative occupied-slot count',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  snapshot.sessionUsage={limit:0,used:1,agentSessions:0,freeSlots:null,auxiliary:[],blockedReason:'Native runtime cleanup is pending or unverified; new work is quarantined',cleanup:[{id:'a'.repeat(64),agentId:snapshot.agents[0].id,cli:'codex',pid:345,keeperInstance:null,requestedAt:1,state:'unverified'}]};
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();
  await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();
  await page.getByRole('button',{name:'📊 Operations & audit',exact:true}).click();
  const budget=page.getByLabel('Shared session budget',{exact:true});
  await expect(budget).toContainText('Occupied slots: 1');await expect(budget).toContainText('PID 345 · unverified');await expect(budget.getByRole('alert')).toContainText('quarantined');
  await page.screenshot({path:'.swarm-reliability/runtime-cleanup-ui.png'});
});
