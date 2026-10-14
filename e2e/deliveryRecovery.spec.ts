import {test,expect} from '@playwright/test';import type {WorldSnapshot} from '../shared/types';
test('keeps unavailable delivery controls closed and refreshes recovery evidence before recovery',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  let recovered=false,readable=true,posts=0;
  await page.route(/\/api\/delivery(?:\?|$)/,route=>route.fulfill({json:{availability:recovered?'ready':'unavailable',policy:null,running:false,runs:[],releases:[],blockers:[],revision:0,message:recovered?'Delivery initialized in maintenance mode':'Delivery history and policy unverified'}}));
  await page.route('**/api/delivery/recovery',route=>{
    if(route.request().method()==='POST'){posts++;expect(route.request().postDataJSON()).toEqual({snapshotSha256:'b'.repeat(64)});recovered=true;return route.fulfill({json:{availability:'ready'}});}
    return readable?route.fulfill({json:{scope:'local-delivery-startup',observedAt:new Date().toISOString(),owner:'absent',history:'empty',canRecover:true,snapshotSha256:'b'.repeat(64),reason:'Validated empty local history; interrupted marker will be preserved.'}}):route.fulfill({status:503,json:{error:'Synthetic inspection failed'}});
  });
  await page.goto('/?quality=low');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.evaluate(()=>{const store=(window as any).__swarmStore;store.setState({demo:false});store.getState().openOverlay({kind:'alm-kiosk'});});
  const panel=page.getByLabel('Delivery startup recovery');await expect(panel).toContainText('Validated empty local history');await expect(page.getByRole('button',{name:'Enable delivery to connected development environment'})).toBeDisabled();await expect(page.getByRole('button',{name:'Run / resume latest release'})).toBeDisabled();await expect(page.getByText('Unverified while delivery initialization is unavailable',{exact:false})).toBeVisible();
  await panel.screenshot({path:'.swarm-reliability/startup-recovery-ui.png'});
  readable=false;await panel.getByRole('button',{name:'Inspect recovery',exact:true}).click();await expect(panel).toContainText('Recovery inspection unavailable');await expect(panel.getByRole('button',{name:'Recover empty delivery history'})).toHaveCount(0);expect(posts).toBe(0);
  readable=true;await panel.getByRole('button',{name:'Inspect recovery',exact:true}).click();await panel.getByRole('button',{name:'Recover empty delivery history'}).click();await expect(page.getByText('Delivery initialized in maintenance mode',{exact:true})).toBeVisible();await expect(panel).toHaveCount(0);expect(posts).toBe(1);
});
