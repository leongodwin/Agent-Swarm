import express from 'express';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {expect,it,vi} from 'vitest';
import {registerArchitectureRoutes} from './architectureRoutes.ts';
import {createBrowserAuth} from './browserAuth.ts';
import {HttpError} from './httpError.ts';
import {HldSynthesisService} from './hldSynthesis.ts';

it('authenticates the non-demo route, resolves checkout ownership and confirms the persisted draft',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hld-route-'));
  const app=express();createBrowserAuth().install(app);app.use(express.json());
  registerArchitectureRoutes(app,{demo:false,synthesisUnavailableReason:'Synthetic corrupt model-job store; preserve it before repair',connectedRepo(id){if(id==='scoped/missing')return {checkoutPath:null};if(id!=='scoped/repo')throw new HttpError(404,'Repository is not connected');return {checkoutPath:root};}});
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof HttpError?error.status:500).json({error:error instanceof Error?error.message:'Failed'}));
  const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input={repoId:'scoped/repo',solutionName:'Synthetic expense solution',problemContext:'Receipt capture',components:[{title:'Receipt app',role:'Maker',badge:'Canvas',details:'Capture receipts',deliverables:['Expense.msapp']}]};
  try {
    expect((await fetch(`${url}/api/hld/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status).toBe(401);
    const session=await fetch(`${url}/api/session`);const cookie=session.headers.get('set-cookie')!.split(';')[0];
    const availability=await fetch(`${url}/api/hld/jobs?repoId=scoped%2Frepo`,{headers:{Cookie:cookie}});expect(availability.status).toBe(200);expect(await availability.json()).toEqual({available:false,jobs:[],unavailableReason:'Synthetic corrupt model-job store; preserve it before repair'});
    const post=(body:unknown)=>fetch(`${url}/api/hld/generate`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
    expect((await post({...input,repoPath:path.dirname(root)})).status).toBe(400);
    expect((await post({...input,repoId:'other/repo'})).status).toBe(404);
    expect((await post({...input,repoId:'scoped/missing'})).status).toBe(409);
    const response=await post(input);expect(response.status).toBe(200);const result=await response.json();
    expect(result).toMatchObject({status:'draft',generationMethod:'requirements-template'});
    expect(result.savedFilePath).toBe(path.join(await fs.realpath(root),'docs','architecture','drafts',`${result.docId}.md`));
    const saved=await fs.readFile(result.savedFilePath,'utf8');expect(saved).toBe(result.markdownContent);expect(saved).toContain('Expense.msapp');
    expect(saved).not.toContain('Approved for Implementation');
    expect(result.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await fetch(`${url}/api/hld/latest?repoId=scoped%2Frepo`)).status).toBe(401);
    const latest=await fetch(`${url}/api/hld/latest?repoId=scoped%2Frepo`,{headers:{Cookie:cookie}});expect(latest.status).toBe(200);
    const artifact=(await latest.json()).artifact;expect(artifact.sha256).toBe(result.artifactSha256);expect(artifact.repoId).toBe('scoped/repo');expect(artifact.input.components).toEqual(input.components);expect(artifact.result.implementationPlan).toEqual(result.implementationPlan);
    expect((await fetch(`${url}/api/hld/latest?repoId=other%2Frepo`,{headers:{Cookie:cookie}})).status).toBe(404);
    expect((await fetch(`${url}/api/hld/latest?repoId=scoped%2Frepo&repoPath=outside`,{headers:{Cookie:cookie}})).status).toBe(400);
    const preview=await post({...input,repoId:undefined});expect(preview.status).toBe(200);expect((await preview.json()).savedFilePath).toBeUndefined();
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
it('authenticates model jobs, binds their project, and exposes an actionable admission blocker',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hld-job-route-'));const start=vi.fn(()=>{throw new Error('Blocked model must not start');});
  const service=new HldSynthesisService(root,{reserve:()=>({running(){},stopping(){},release(){}}),assertOpen(){},context(){return {checkoutPath:root,fingerprint:'synthetic',copilotPaused:true,skills:[]};},admission:async()=> 'Synthetic model account is not authenticated',start});await service.init();
  const app=express();createBrowserAuth().install(app);app.use(express.json());registerArchitectureRoutes(app,{demo:false,synthesis:service,connectedRepo(id){if(!['scoped/repo','other/repo'].includes(id))throw new HttpError(404,'Not connected');return {checkoutPath:root};}});
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof HttpError?error.status:500).json({error:error instanceof Error?error.message:'Failed'}));
  const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input={repoId:'scoped/repo',solutionName:'Synthetic architecture',problemContext:'Synthetic requirements only',components:[]};
  try{
    expect((await fetch(`${url}/api/hld/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status).toBe(401);
    const cookie=(await fetch(`${url}/api/session`)).headers.get('set-cookie')!.split(';')[0];const headers={Cookie:cookie,'Content-Type':'application/json'};
    expect((await fetch(`${url}/api/hld/jobs`,{method:'POST',headers,body:JSON.stringify({...input,repoPath:'outside'})})).status).toBe(400);
    const response=await fetch(`${url}/api/hld/jobs`,{method:'POST',headers,body:JSON.stringify(input)});expect(response.status).toBe(202);const {job}=await response.json();
    await vi.waitFor(()=>expect(service.view('scoped/repo',job.id)[0].status).toBe('blocked'));
    const poll=await fetch(`${url}/api/hld/jobs/${job.id}?repoId=scoped%2Frepo`,{headers});expect((await poll.json()).job.error).toContain('not authenticated');
    const history=await (await fetch(`${url}/api/hld/jobs?repoId=scoped%2Frepo`,{headers})).json();expect(history.summary).toMatchObject({scope:'retained-codex-synthesis-jobs',completeWindow:false,completeWindowCompletionPercent:null,recorded:{completed:0,blocked:1}});
    const other=await (await fetch(`${url}/api/hld/jobs?repoId=other%2Frepo`,{headers})).json();expect(other.summary.recorded.blocked).toBe(0);
    expect((await fetch(`${url}/api/hld/jobs/${job.id}?repoId=other%2Frepo`,{headers})).status).toBe(404);
    expect((await fetch(`${url}/api/hld/jobs/${job.id}/result?repoId=scoped%2Frepo`,{headers})).status).toBe(409);
    expect((await fetch(`${url}/api/hld/jobs?repoId=scoped%2Frepo&repoPath=outside`,{headers})).status).toBe(400);expect(start).not.toHaveBeenCalled();
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await service.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
