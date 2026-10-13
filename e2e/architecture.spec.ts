import {test,expect} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';

test('architecture draft declares scope and preserves demo write denial and review boundaries',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});
  await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;
  snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  snapshot.repos[0].mission='Synthetic receipt capture requirements.';
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();
  await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();
  await page.getByRole('button',{name:'🏢 Floors & repos',exact:true}).click();
  await page.getByRole('button',{name:'Architecture draft',exact:true}).first().click();
  await expect(page.getByText('Draft · unreviewed',{exact:true})).toBeVisible();
  await expect(page.getByText('Synthetic receipt capture requirements.',{exact:true})).toBeVisible();
  await page.getByLabel('Component title',{exact:true}).fill('Receipt capture Canvas app');
  await page.getByLabel('Platform or category',{exact:true}).fill('Canvas');
  await page.getByLabel('Functional scope',{exact:true}).fill('Employees attach receipts.');
  await page.getByLabel('Deliverables, one per line',{exact:true}).fill('Expense.msapp');
  await page.getByRole('button',{name:'Add component',exact:true}).click();
  await page.getByRole('tab',{name:'Requirements & gaps',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Implementation plan',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('heading',{name:'Receipt capture Canvas app',exact:true})).toBeVisible();
  await expect(page.getByText('Expense.msapp',{exact:true})).toBeVisible();
  const saving=page.waitForResponse(response=>response.url().endsWith('/api/hld/generate')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Save draft to repository',exact:true}).click();
  const response=await saving;expect(response.status()).toBe(409);
  expect((await response.json()).error).toBe('Demo mode does not write project files');
  await expect(page.getByText('Draft · unreviewed',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Requirements & gaps',exact:true}).click();
  await page.screenshot({path:'.swarm-reliability/architecture-draft-ui-2026-10-13.png'});
});

test('reloads stored requirements and plan without calling the template model synthesis complete',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;snapshot.repos[0].mission='Current project scope differs.';
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  const input={solutionName:'Stored receipt architecture',problemContext:'Stored receipt requirements.',components:[{title:'Stored Canvas receipt app',role:'Maker',badge:'Canvas',details:'Capture every receipt',deliverables:['StoredExpense.msapp']}]};
  const result=await (await request.post('/api/hld/generate',{data:input})).json();
  await page.route('**/api/hld/latest?*',route=>route.fulfill({json:{artifact:{schemaVersion:1,repoId:snapshot.repos[0].id,input,result,sha256:'a'.repeat(64)}}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();await page.getByRole('button',{name:'🏢 Floors & repos',exact:true}).click();await page.getByRole('button',{name:'Architecture draft',exact:true}).first().click();
  await page.getByRole('button',{name:'Load saved draft',exact:true}).click();
  await expect(page.getByText('Stored receipt requirements.',{exact:true})).toBeVisible();await expect(page.getByText('Draft · unreviewed',{exact:true})).toBeVisible();
  await expect(page.getByText('Requirements template. Model synthesis, architecture approval and tenant verification are pending.',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Implementation plan',exact:true}).click();await expect(page.getByRole('heading',{name:'Stored Canvas receipt app',exact:true})).toBeVisible();await expect(page.getByText('StoredExpense.msapp',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use current project brief',exact:true}).click();await page.getByRole('tab',{name:'Requirements & gaps',exact:true}).click();await expect(page.getByText('Current project scope differs.',{exact:true})).toBeVisible();
  await page.screenshot({path:'.swarm-reliability/architecture-reload-ui-2026-10-13.png'});
});
