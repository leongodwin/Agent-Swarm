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

test('delivery exposes the pinned architecture and keeps an unreviewed or rejected release disabled',async({page})=>{
  const docId='HLD-11111111-1111-4111-8111-111111111111';
  let rejected=false;
  await page.route(/\/api\/delivery(?:\?|$)/,route=>route.fulfill({json:{policy:{enabled:true,environmentUrl:'https://development.crm4.dynamics.com',copilotPaused:true},running:false,message:'Independent architecture review required',runs:[],blockers:[],releases:[{id:'synthetic-release',repoId:'synthetic/project',head:'a'.repeat(40),approvedAt:new Date().toISOString(),approvedBy:'qa',plan:{name:'Synthetic architecture-bound release',owner:'dev',qaOwner:'qa',architecture:{docId,sha256:'b'.repeat(64)},requiredIssues:[1],components:['Receipt capture']},architectureReview:rejected?{reviewer:'qa',artifactSha256:'b'.repeat(64),decision:'rejected',notes:'Permission boundaries and recovery decisions remain unresolved; the architecture is rejected.'}:undefined}]}}));
  await page.goto('/');await expect(page.getByRole('button',{name:'Enter the office'})).toBeEnabled();
  const open=()=>page.evaluate(()=>{const store=(window as any).__swarmStore;store.setState({demo:false});store.getState().openOverlay({kind:'alm-kiosk'});});
  await open();await expect(page.getByText(`Architecture: ${docId} · independent review pending`,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Run / resume this release',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');rejected=true;await open();
  await expect(page.getByText(`Architecture: ${docId} · rejected by qa`,{exact:true})).toBeVisible();
  await expect(page.getByText('Permission boundaries and recovery decisions remain unresolved; the architecture is rejected.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Run / resume this release',exact:true})).toBeDisabled();
  await page.screenshot({path:'.swarm-reliability/architecture-gate-ui-2026-10-13.png'});
});

test('architecture board tracks model jobs and loads an unreviewed model version explicitly',async({page,request})=>{
  await request.get('/api/session');const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;
  snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  await page.routeWebSocket('/ws',socket=>socket.send(JSON.stringify({type:'snapshot',data:snapshot})));
  const id='11111111-1111-4111-8111-111111111111',docId=`HLD-${id}`,startedAt=Date.now();
  let status='blocked';
  const job=()=>({id,repoId:snapshot.repos[0].id,status,runtime:'codex-cli',startedAt,deadlineMs:300000,events:[],costUsd:0,turns:1,error:status==='blocked'?'Model account is signed out':undefined,elapsedMs:status==='completed'?4000:undefined,result:status==='completed'?{docId,artifactSha256:'a'.repeat(64)}:undefined});
  await page.route('**/api/hld/jobs?*',route=>route.fulfill({json:{available:true,jobs:[job()]}}));
  await page.route('**/api/hld/jobs',async route=>{expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON().repoId).toBe(snapshot.repos[0].id);status='running';await route.fulfill({status:202,json:{job:job()}});});
  await page.route(`**/api/hld/jobs/${id}/result?*`,route=>route.fulfill({json:{artifact:{schemaVersion:1,repoId:snapshot.repos[0].id,sha256:'a'.repeat(64),input:{solutionName:'Synthetic model architecture',problemContext:'Model requirements supplied for this UI test.',components:[]},result:{docId,generatedAt:startedAt+4000,solutionName:'Synthetic model architecture',status:'draft',generationMethod:'model-synthesis',synthesis:{runtime:'codex-cli',jobId:id,startedAt,elapsedMs:4000,deadlineMs:300000},missingEvidence:['Independent review remains pending'],implementationPlan:[{id:'verify',title:'Independent verification',deliverables:['Runtime evidence'],acceptance:['Observe the real deployed app']}],markdownContent:'# Synthetic model architecture',mermaidDiagrams:{topology:'flowchart LR\n A-->B',erd:'flowchart LR\n A-->B',sequence:'sequenceDiagram\n A->>B: Submit'}}}}}));
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();await page.getByRole('button',{name:'🏢 Floors & repos',exact:true}).click();await page.getByRole('button',{name:'Architecture draft',exact:true}).first().click();
  await expect(page.getByText('Model account is signed out',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Synthesize with Codex',exact:true}).click();
  await expect(page.getByText('Model job: running',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save draft to repository',exact:true})).toBeDisabled();
  status='completed';await expect(page.getByRole('button',{name:'Load model-generated draft',exact:true})).toBeVisible();await page.getByRole('button',{name:'Load model-generated draft',exact:true}).click();
  await expect(page.getByText('Model requirements supplied for this UI test.',{exact:true})).toBeVisible();await expect(page.getByText('Model-generated draft. Independent architecture approval and tenant verification are pending.',{exact:true})).toBeVisible();await expect(page.getByText('Draft · unreviewed',{exact:true})).toBeVisible();
  await page.screenshot({path:'.swarm-reliability/synthesis-model-ui-2026-10-13.png'});
});
