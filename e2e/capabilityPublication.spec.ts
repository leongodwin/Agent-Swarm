import {test,expect} from '@playwright/test';import type {WorldSnapshot} from '../shared/types';
test('shows storage failure and holds delivery execution while retaining readiness repair controls',async({page,request})=>{
 await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');const snapshot=await(await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
 await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
 await page.route(/\/api\/delivery(?:\?|$)/,route=>route.fulfill({json:{availability:'ready',policy:{enabled:true,copilotPaused:true,environmentUrl:'https://synthetic.crm4.dynamics.com'},running:false,runs:[],releases:[],blockers:[],revision:0}}));
 await page.route('**/api/capabilities',route=>route.fulfill({json:{results:[],configuredProjects:[],unavailableReason:'Capability evidence publication failed; repair storage and refresh readiness'}}));
 await page.goto('/?quality=low');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.evaluate(()=>{const store=(window as any).__swarmStore;store.setState({demo:false});store.getState().openOverlay({kind:'alm-kiosk'});});
 const alert=page.getByRole('alert').filter({hasText:'Readiness could not be saved'});await expect(alert).toBeVisible();await expect(page.getByRole('button',{name:'Run / resume latest release',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Pause automatic delivery',exact:true})).toBeEnabled();
 await page.getByText('Capabilities and implementation starters',{exact:true}).click();await expect(page.getByRole('button',{name:'Refresh readiness',exact:true})).toBeEnabled();await alert.screenshot({path:'.swarm-reliability/capability-publication-ui.png'});
});
