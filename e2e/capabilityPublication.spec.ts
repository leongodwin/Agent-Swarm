import {test,expect} from '@playwright/test';import type {WorldSnapshot} from '../shared/types';
for(const kind of ['storage','limit','invalid'] as const)test(`shows ${kind} failure and holds delivery execution while retaining repair controls`,async({page,request})=>{
 await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');const snapshot=await(await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
 await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
 await page.route(/\/api\/delivery(?:\?|$)/,route=>route.fulfill({json:{availability:'ready',policy:{enabled:true,copilotPaused:true,environmentUrl:'https://synthetic.crm4.dynamics.com'},running:false,runs:[],releases:[],blockers:[],revision:0}}));
 await page.route('**/api/capabilities',route=>route.fulfill({json:{results:[],configuredProjects:[],unavailableKind:kind,unavailableReason:'Synthetic acknowledged publication hold'}}));
 await page.goto('/?quality=low');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.evaluate(()=>{const store=(window as any).__swarmStore;store.setState({demo:false});store.getState().openOverlay({kind:'alm-kiosk'});});
 const message=kind==='storage'?'Readiness could not be saved':kind==='limit'?'Readiness records exceed their size or processing limit':'Readiness records could not be validated';
 const alert=page.getByRole('alert').filter({hasText:message});await expect(alert).toBeVisible();await expect(page.getByRole('button',{name:'Run / resume latest release',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Pause automatic delivery',exact:true})).toBeEnabled();
 await page.getByText('Capabilities and implementation starters',{exact:true}).click();await expect(page.getByRole('button',{name:'Refresh readiness',exact:true})).toBeEnabled();await alert.screenshot({animations:'disabled',path:`.swarm-reliability/capability-${kind}-ui.png`});
});
