import {z} from 'zod';import {deliveryCommands} from './delivery.ts';import {parseUnambiguousJson} from './unambiguousJson.ts';
/** Fixed reads of the current GitHub principal and this server-bound repository. */
export async function repositoryAccessMetadata(repoId:string,cwd:string,signal:AbortSignal,guard:()=>void,run=deliveryCommands.run){
 const check=()=>{signal.throwIfAborted();guard();};check();
 try{
  if(!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repoId))throw Error();
  const read=async(route:string)=>{check();const raw=await run({executable:'gh',args:['api','--method','GET',route]},cwd,{},signal);check();return parseUnambiguousJson(raw,{maxBytes:1024*1024});};
  const principal=z.object({id:z.number().int().positive(),login:z.string().min(1)}),repository=z.object({id:z.number().int().positive(),full_name:z.string(),private:z.boolean(),visibility:z.enum(['private','public','internal']),owner:principal,permissions:z.object({admin:z.boolean(),push:z.boolean(),pull:z.boolean()})});
  const pass=async()=>{const user=principal.parse(await read('user')),repo=repository.parse(await read('repos/'+repoId)),collaborators=z.array(principal).max(99).parse(await read('repos/'+repoId+'/collaborators?per_page=100'));if(repo.full_name.toLowerCase()!==repoId.toLowerCase()||new Set(collaborators.map(c=>c.id)).size!==collaborators.length)throw Error();return{user,repo,collaborators};};
  const before=await pass(),after=await pass();check();if(JSON.stringify(before)!==JSON.stringify(after))throw Error();
  return{status:'observed' as const,scope:'bound-repository-access-metadata',repoId,...after,privateSoleOwner:after.repo.private&&after.repo.visibility==='private'&&after.repo.owner.id===after.user.id&&after.repo.permissions.admin&&after.repo.permissions.push&&after.repo.permissions.pull&&after.collaborators.length===1&&after.collaborators[0].id===after.user.id,limits:['Repeated repository visibility, caller permissions and bounded collaborator metadata only','No repository permission changes, organisation policy assurance or tenant/runtime authority']};
 }catch{check();return{status:'unavailable' as const,scope:'bound-repository-access-metadata',repoId,reason:'Repository/principal metadata unavailable, changed or collaborator response saturated; no access changes'};}
}

