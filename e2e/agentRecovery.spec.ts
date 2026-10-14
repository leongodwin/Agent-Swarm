import {test,expect,type WebSocketRoute} from '@playwright/test';
import type {WorldSnapshot} from '../shared/types';

test('terminal shows recovery eligibility and clears advice after an agent update',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});await request.get('/api/session');
  const snapshot=await (await request.get('/api/state')).json() as WorldSnapshot;
  snapshot.settings.setupDone=true;snapshot.settings.tutorialStep=-1;
  const worker=snapshot.agents.find(row=>row.role==='dev')!;
  snapshot.agents=snapshot.agents.filter(row=>row.role==='ceo'||row.id===worker.id);
  worker.status='error';worker.terminal=false;worker.lastError='Synthetic authentication outage';
  worker.recovery={kind:'preflight',reason:worker.lastError,failures:2,nextAttemptAt:new Date(Date.now()+3600000).toISOString()};
  let channel:WebSocketRoute|undefined;
  await page.routeWebSocket('/ws',socket=>{channel=socket;socket.send(JSON.stringify({type:'snapshot',data:snapshot}));});
  await page.goto('/');await page.getByRole('button',{name:'Enter the office',exact:true}).click();
  await page.getByRole('button',{name:'Open operations and tool audit',exact:true}).click();
  await page.getByRole('button',{name:'👩‍💻 Team',exact:true}).click();
  await page.getByRole('button',{name:'Terminal',exact:true}).click();
  const panel=page.getByLabel('Agent recovery',{exact:true});
  await expect(panel).toContainText('Readiness retry scheduled');await expect(panel).toContainText('Office drain, capacity and readiness checks still apply');
  worker.recovery.nextAttemptAt=new Date(Date.now()-1000).toISOString();channel!.send(JSON.stringify({type:'agent',agent:worker}));
  await expect(panel).toContainText('Readiness retry eligible');
  worker.recovery={kind:'model',reason:'Synthetic model is unavailable',nextAttemptAt:null};channel!.send(JSON.stringify({type:'agent',agent:worker}));
  await expect(panel).toContainText('Model needs attention');await expect(panel).not.toContainText('retry eligible');
  await panel.screenshot({path:'.swarm-reliability/agent-recovery-ui.png'});
  worker.recovery=null;worker.status='working';worker.lastError=null;channel!.send(JSON.stringify({type:'agent',agent:worker}));
  await expect(panel).toHaveCount(0);
});
