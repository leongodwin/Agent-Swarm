import fs from 'node:fs/promises';
import path from 'node:path';
import {writePinnedSource} from '../server/testFixtures/pinnedArtifact.ts';
import {verifyEmptySolution,digest} from '../server/pinnedPreparation.ts';
const root=path.resolve(process.argv[2]),source=path.join(root,'source'),target={environmentUrl:'https://org68dad46d.crm4.dynamics.com',binding:{organizationId:'276d6f5c-20f4-46de-a631-825a64953d21',userId:'5a89d846-73f1-eb11-94ee-000d3ab40fca'},identity:{tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',username:'leon@graspai.co.uk',environmentId:'dfa95786-271b-4505-a842-59c54890e019'}};
const packageFile=path.resolve('output/CubeFarmResumeProbe.zip'),packageBytes=await fs.readFile(packageFile);await verifyEmptySolution(packageFile,'CubeFarmResumeProbe');
if(digest(packageBytes)!=='962f73926c7dc1d52135d9910b74b8e7508a2b8f8c40d2999bed1999038c3a4a')throw new Error('Approved exported probe package differs');
const prepared=await writePinnedSource(source,'leongodwin/Expnese-App2',target,packageBytes);
await fs.writeFile(path.join(root,'setup.json'),JSON.stringify({scope:'isolated-local-probe-commit-no-push',root,source,target,packageFile,head:prepared.head,plan:prepared.plan,manifest:prepared.manifest,packageSha256:prepared.packageSha256},null,2),{flag:'wx'});
