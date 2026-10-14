import crypto from 'node:crypto';
import {z} from 'zod';
import {hldArtifactSchema,type HldArtifact} from '../shared/hldArtifact.ts';
import {HttpError} from './httpError.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
export const architectureReviewSchema=z.strictObject({artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','rejected']),notes:z.string().trim().min(80).max(8000)});
export function verifyCommittedArchitecture(json:string,markdown:string,repoId:string,reference:{docId:string;sha256:string}):HldArtifact {
  if(Buffer.byteLength(json)>8*1024*1024||Buffer.byteLength(markdown)>1024*1024)throw new HttpError(413,'Committed architecture exceeds its bound');
  const artifact=hldArtifactSchema.parse(parseUnambiguousJson(json,{maxBytes:8*1024*1024}));
  const {input,result}=artifact;
  const digest=crypto.createHash('sha256').update(JSON.stringify({repoId:artifact.repoId,input,result})).digest('hex');
  if(artifact.repoId!==repoId||result.docId!==reference.docId||artifact.sha256!==reference.sha256||digest!==reference.sha256||result.markdownContent!==markdown)throw new HttpError(409,'Committed architecture differs from the pinned repository, version or content');
  return artifact;
}
export function requireArchitectureReview(release:{plan:{architecture?:{docId:string;sha256:string};qaOwner:string;owner:string};architectureReview?:{reviewer:string;artifactSha256:string;decision:string}}){
  const binding=release.plan.architecture,review=release.architectureReview;
  if(!binding||!review||review.decision!=='approved'||review.reviewer!==release.plan.qaOwner||review.reviewer===release.plan.owner||review.artifactSha256!==binding.sha256)throw new HttpError(409,'Independent review of the exact pinned architecture is required before release approval or delivery');
}
