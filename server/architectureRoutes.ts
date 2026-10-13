import type {Express} from 'express';
import {generateHld} from './hldAgent.ts';
import {parseBody,hldSchema} from './requestSchemas.ts';
import {HttpError} from './httpError.ts';
import {loadLatestHld} from './hldArtifacts.ts';
import {z} from 'zod';
import type {HldSynthesisService} from './hldSynthesis.ts';

/** Mount after office authentication. Clients cannot supply filesystem paths. */
export function registerArchitectureRoutes(app:Express,context:{demo:boolean;connectedRepo(id:string):{checkoutPath?:string|null};assertOpen?:()=>void;synthesis?:HldSynthesisService;synthesisUnavailableReason?:string}) {
  const service=(repoId:string)=>{context.assertOpen?.();context.connectedRepo(repoId);if(context.demo||!context.synthesis)throw new HttpError(409,'Model synthesis is unavailable in this runtime');return context.synthesis;};
  app.post('/api/hld/jobs',(req,res,next)=>{void(async()=>{const {repoId,...input}=parseBody(hldSchema.extend({repoId:z.string().min(1).max(8000)}),req.body);res.status(202).json({job:await service(repoId).start(repoId,input)});})().catch(next);});
  app.get('/api/hld/jobs',(req,res,next)=>{try{context.assertOpen?.();const {repoId}=parseBody(z.strictObject({repoId:z.string().min(1).max(8000)}),req.query);context.connectedRepo(repoId);res.json({available:!context.demo&&!!context.synthesis,unavailableReason:context.synthesisUnavailableReason,jobs:context.demo||!context.synthesis?[]:context.synthesis.view(repoId)});}catch(error){next(error);}});
  app.get('/api/hld/jobs/:id',(req,res,next)=>{try{const {repoId}=parseBody(z.strictObject({repoId:z.string().min(1).max(8000)}),req.query);res.json({job:service(repoId).view(repoId,String(req.params.id))[0]});}catch(error){next(error);}});
  app.get('/api/hld/jobs/:id/result',(req,res,next)=>{void(async()=>{const {repoId}=parseBody(z.strictObject({repoId:z.string().min(1).max(8000)}),req.query);res.json({artifact:await service(repoId).result(repoId,String(req.params.id))});})().catch(next);});
  app.post('/api/hld/jobs/:id/cancel',(req,res,next)=>{try{const {repoId}=parseBody(z.strictObject({repoId:z.string().min(1).max(8000)}),req.body);res.json({job:service(repoId).cancel(repoId,String(req.params.id))});}catch(error){next(error);}});
  app.post('/api/hld/generate',(req,res,next)=>{
    void (async()=>{
      context.assertOpen?.();
      const {repoId:id,...input}=parseBody(hldSchema,req.body);
      const repo=id?context.connectedRepo(id):undefined;
      if(repo&&context.demo)throw new HttpError(409,'Demo mode does not write project files');
      if(repo&&!repo.checkoutPath)throw new HttpError(409,'Repository checkout is unavailable; restore it before saving a draft');
      const result=await generateHld({...input,repoPath:repo?.checkoutPath||undefined},()=>context.assertOpen?.(),id);
      context.assertOpen?.();
      res.json(result);
    })().catch(next);
  });
  app.get('/api/hld/latest',(req,res,next)=>{
    void(async()=>{
      context.assertOpen?.();const {repoId}=parseBody(z.strictObject({repoId:z.string().min(1).max(8000)}),req.query);
      const repo=context.connectedRepo(repoId);if(context.demo)throw new HttpError(409,'Demo cannot read project architecture artifacts');
      if(!repo.checkoutPath)throw new HttpError(409,'Repository checkout is unavailable');
      const artifact=await loadLatestHld(repo.checkoutPath,()=>context.assertOpen?.(),repoId);context.assertOpen?.();res.json({artifact});
    })().catch(next);
  });
}
