import crypto from 'node:crypto';
import {expect,it} from 'vitest';
import {generateHldContent} from '../shared/hld.ts';
import {verifyCommittedArchitecture,requireArchitectureReview,architectureReviewSchema} from './architectureGate.ts';
const input={solutionName:'Synthetic architecture',problemContext:'Capture required business decisions',components:[]};
const result=generateHldContent(input),repoId='synthetic/project';
const sha256=crypto.createHash('sha256').update(JSON.stringify({repoId,input,result})).digest('hex');
const artifact={schemaVersion:1,repoId,input,result,sha256},reference={docId:result.docId,sha256};
it('binds committed requirements, diagrams and plan to the project and exact content',()=>{
  expect(verifyCommittedArchitecture(JSON.stringify(artifact),result.markdownContent,repoId,reference)).toEqual(artifact);
  expect(()=>verifyCommittedArchitecture(JSON.stringify({...artifact,input:{...input,problemContext:'Altered'}}),result.markdownContent,repoId,reference)).toThrow('differs');
  expect(()=>verifyCommittedArchitecture(JSON.stringify(artifact),result.markdownContent+' changed',repoId,reference)).toThrow('differs');
  expect(()=>verifyCommittedArchitecture(JSON.stringify(artifact),result.markdownContent,'other/project',reference)).toThrow('differs');
  expect(()=>verifyCommittedArchitecture(JSON.stringify(artifact),result.markdownContent,repoId,{...reference,sha256:'0'.repeat(64)})).toThrow('differs');
  expect(()=>verifyCommittedArchitecture(JSON.stringify(artifact),result.markdownContent,repoId,{...reference,docId:'HLD-other'})).toThrow('differs');
});
it('denies malformed, unbounded and fabricated architecture records',()=>{
  for(const json of ['null','{}','invalid',JSON.stringify({...artifact,approved:true})])expect(()=>verifyCommittedArchitecture(json,result.markdownContent,repoId,reference)).toThrow();
  expect(()=>verifyCommittedArchitecture(JSON.stringify(artifact),'x'.repeat(1024*1024+1),repoId,reference)).toThrow('bound');
  expect(()=>verifyCommittedArchitecture(' '.repeat(8*1024*1024+1),result.markdownContent,repoId,reference)).toThrow('bound');
});
it.each(['repoId','sha256','nested-input'])('rejects duplicate committed architecture %s fields despite a matching final digest',field=>{
 const original=JSON.stringify(artifact),json=field==='nested-input'?original.replace('"problemContext":','"problemContext":"unapproved design","problemContext":'):`{"${field==='sha256'?'\\u0073ha256':field}":"unapproved",${original.slice(1)}`;
 expect(()=>verifyCommittedArchitecture(json,result.markdownContent,repoId,reference)).toThrow('ambiguity');
});
it('requires independent approval of the exact version and never treats a saved draft as approval',()=>{
  const plan={architecture:reference,qaOwner:'qa',owner:'dev'},review={reviewer:'qa',artifactSha256:sha256,decision:'approved'};
  expect(()=>requireArchitectureReview({plan})).toThrow('Independent');
  expect(()=>requireArchitectureReview({plan,architectureReview:review})).not.toThrow();
  for(const invalid of [{...review,decision:'rejected'},{...review,reviewer:'dev'},{...review,artifactSha256:'0'.repeat(64)}])expect(()=>requireArchitectureReview({plan,architectureReview:invalid})).toThrow('Independent');
  expect(()=>requireArchitectureReview({plan:{qaOwner:'qa',owner:'dev'},architectureReview:review})).toThrow('Independent');
  expect(architectureReviewSchema.safeParse({artifactSha256:sha256,decision:'approved',notes:' '.repeat(80)}).success).toBe(false);
});
