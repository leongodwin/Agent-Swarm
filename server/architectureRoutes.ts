import type {Express} from 'express';
import {generateHld} from './hldAgent.ts';
import {parseBody,hldSchema} from './requestSchemas.ts';
import {HttpError} from './httpError.ts';

/** Mount after office authentication. Clients cannot supply filesystem paths. */
export function registerArchitectureRoutes(app:Express,context:{demo:boolean;connectedRepo(id:string):{checkoutPath?:string|null};assertOpen?:()=>void}) {
  app.post('/api/hld/generate',(req,res,next)=>{
    void (async()=>{
      context.assertOpen?.();
      const {repoId:id,...input}=parseBody(hldSchema,req.body);
      const repo=id?context.connectedRepo(id):undefined;
      if(repo&&context.demo)throw new HttpError(409,'Demo mode does not write project files');
      if(repo&&!repo.checkoutPath)throw new HttpError(409,'Repository checkout is unavailable; restore it before saving a draft');
      const result=await generateHld({...input,repoPath:repo?.checkoutPath||undefined});
      context.assertOpen?.();
      res.json(result);
    })().catch(next);
  });
}
