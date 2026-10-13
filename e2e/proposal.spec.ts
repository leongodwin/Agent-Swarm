import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';

test('commercial draft keeps estimates unknown and computes only explicit unreviewed inputs',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;
  snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();
  await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();await page.getByRole('button',{name:'🏢 Floors & repos',exact:true}).click();
  await page.getByRole('button',{name:'Commercial draft',exact:true}).first().click();
  await page.getByRole('button',{name:'Costs & benefits',exact:true}).click();
  await expect(page.getByText('Not estimated',{exact:true})).toHaveCount(4);
  await page.getByLabel('Licence or SKU label',{exact:true}).fill('Synthetic customer licence');
  await page.getByLabel('Licence category',{exact:true}).fill('App');await page.getByLabel('Licence quantity',{exact:true}).fill('1');
  await page.getByLabel('Monthly unit price',{exact:true}).fill('100');await page.getByLabel('Quote source or assumption',{exact:true}).fill('Synthetic unverified scenario');
  await page.getByRole('button',{name:'Add licence line',exact:true}).click();
  await page.getByLabel('Implementation cost',{exact:true}).fill('1000');await page.getByLabel('Other monthly operating costs',{exact:true}).fill('0');
  await page.getByLabel('Minutes saved per transaction',{exact:true}).fill('1');await page.getByLabel('Hourly cost',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Declared scope',exact:true}).click();await page.getByLabel('Users in scope',{exact:true}).fill('1');await page.getByLabel('Monthly transactions',{exact:true}).fill('1');
  const generating=page.waitForResponse(response=>response.url().endsWith('/api/proposals/generate')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Generate scenario via server',exact:true}).click();const response=await generating;
  expect(response.ok()).toBe(true);const result=await response.json();expect(result).toMatchObject({status:'draft',generationMethod:'commercial-scenario',threeYearRoiPercent:-99.99});
  await page.getByRole('button',{name:'Costs & benefits',exact:true}).click();await expect(page.getByText('-99.99%',{exact:true})).toBeVisible();
  await expect(page.getByText('Draft · unreviewed',{exact:true})).toBeVisible();
  await page.screenshot({path:'.swarm-reliability/commercial-draft-ui-2026-10-13.png'});
});
