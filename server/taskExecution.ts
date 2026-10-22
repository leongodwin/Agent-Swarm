import {git} from './exec.ts';
import type {PrDetails} from './github.ts';
import {HttpError} from './httpError.ts';
/** Only the office merge observer can turn an exact independent QA head into input authority. */
export function mergedTaskEvidence(pr:PrDetails,issue:number,headSha:string,defaultBranch:string){
  if(pr.baseRefName!==defaultBranch||pr.state!=='MERGED'||pr.headSha!==headSha||!pr.closesIssues.includes(issue)||!pr.mergeCommitSha||!/^[a-f0-9]{40,64}$/.test(pr.mergeCommitSha))throw new HttpError(409,'Exact independently tested PR must be merged and linked to this issue before task acceptance');
  return {prNumber:pr.number,headSha:pr.headSha,mergeCommitSha:pr.mergeCommitSha};
}
export async function verifyTaskInputs(cwd:string,commits:string[]){
  for(const commit of commits){
    if(!/^[a-f0-9]{40,64}$/.test(commit))throw new HttpError(409,'Invalid prerequisite merge commit');
    try{await git(['merge-base','--is-ancestor',commit,'HEAD'],{cwd});}
    catch{throw new HttpError(409,`Prerequisite merge ${commit} is absent from this checkout; refresh the default branch before authoring`);}
  }
}
