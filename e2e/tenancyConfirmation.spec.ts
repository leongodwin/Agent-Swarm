import {test,expect} from '@playwright/test';import type {WorldSnapshot} from '../shared/types';
test('retains the sign-in handle through a failed status read and only displays confirmed identity after verification',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  const id='11111111-1111-4111-8111-111111111111';let reads=0,confirmed=false,posts=0;
  await page.route('**/api/tenancy',route=>route.fulfill({json:{tenantName:'',tenantDomain:'',tenantId:'',user:'',environments:[],isReal:false,status:'disconnected'}}));
  await page.route('**/api/tenancy/login',route=>{posts++;return route.fulfill({json:{id,status:'pending',phase:'authenticating',ok:false,message:'Waiting for synthetic sign-in'}});});
  await page.route('**/api/tenancy/login/'+id,route=>{
    reads++;if(reads===1)return route.fulfill({status:503,json:{error:'Synthetic transient observation failure'}});
    return route.fulfill({json:confirmed?{id,status:'completed',ok:true,message:'PAC account and environment verified.',observation:{scope:'pac-profile-and-organization',checkedAt:new Date().toISOString(),profileIndex:1,environmentUrl:'https://synthetic.crm4.dynamics.com',username:'synthetic@example.com',organizationId:id,userId:id,environmentId:id}}:{id,status:'pending',phase:'verifying',ok:false,message:'Verifying the active PAC account and environment…'}});
  });
  await page.goto('/?quality=low');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.evaluate(()=>{(window as any).__swarmStore.getState().openOverlay({kind:'dlp-kiosk'});});
  await page.getByRole('button',{name:'Connect Tenancy / Environment',exact:false}).click();await page.getByRole('button',{name:'Authenticate & Set Active',exact:true}).click();
  await expect(page.getByText('Authentication status is temporarily unavailable.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Authenticating…',exact:true})).toBeDisabled();await expect(page.getByText('Confirmed account:',{exact:false})).toHaveCount(0);
  await expect(page.getByText('Verifying the active PAC account and environment…',{exact:true})).toBeVisible();confirmed=true;
  await expect(page.getByText('Confirmed account: synthetic@example.com',{exact:false})).toBeVisible();await expect(page.getByText('Confirmed account:',{exact:false})).toContainText('This verifies PAC identity; tenant policy, licences and deployment permissions require their own readiness checks.');expect(posts).toBe(1);
  await page.getByText('Confirmed account:',{exact:false}).screenshot({path:'.swarm-reliability/tenancy-confirmation-ui.png'});
});
test('stops observing a sign-in handle that the server reports missing',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  const id='22222222-2222-4222-8222-222222222222';let reads=0,posts=0;
  await page.route('**/api/tenancy',route=>route.fulfill({json:{tenantName:'',tenantDomain:'',tenantId:'',user:'',environments:[],isReal:false,status:'disconnected'}}));
  await page.route('**/api/tenancy/login',route=>{posts++;return route.fulfill({json:{id,status:'pending',ok:false,message:'Waiting for synthetic sign-in'}});});
  await page.route('**/api/tenancy/login/'+id,route=>{reads++;return route.fulfill({status:404,json:{error:'Authentication request not found'}});});
  await page.goto('/?quality=low');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.evaluate(()=>{(window as any).__swarmStore.getState().openOverlay({kind:'dlp-kiosk'});});
  await page.getByRole('button',{name:'Connect Tenancy / Environment',exact:false}).click();await page.getByRole('button',{name:'Authenticate & Set Active',exact:true}).click();await expect(page.getByText('This authentication request no longer exists. Start a new sign-in request.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Authenticate & Set Active',exact:true})).toBeEnabled();await page.waitForTimeout(2100);expect(reads).toBe(1);expect(posts).toBe(1);
});
