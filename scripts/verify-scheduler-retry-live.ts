import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {schedulerRetryLivePassed} from './schedulerRetryChecks.ts';
if(!process.argv.includes('--live'))throw new Error('Requires explicit --live: authenticated synthetic scheduler verification');
const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cubefarm-scheduler-retry-'));
const phases:Record<string,any>[]=[];let error:string|undefined;
try{
 for(let phase=1;phase<=4;phase++){
  const result=await promisify(execFile)(process.execPath,['--import','tsx','scripts/verify-scheduler-retry-child.ts','--live',root,String(phase)],{env:{...process.env,SWARM_HOME:root,SWARM_PORT:'0'},windowsHide:true,timeout:105000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(root,`phase-${phase}.log`),result.stdout+result.stderr);
  phases.push(JSON.parse(fs.readFileSync(path.join(root,`phase-${phase}.json`),'utf8')));
  console.log(JSON.stringify({phase,launched:phases.at(-1)?.launched,executorEntries:phases.at(-1)?.launches.length}));
 }
}catch(caught){error=caught instanceof Error?caught.message:String(caught);}
const file=path.join(root,'executor-launches.jsonl');const executorRows=fs.existsSync(file)?fs.readFileSync(file,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line)):[];
const report={root,scope:'real scheduler and persistent state; synthetic repository, readiness and semantic acceptance; authenticated Gemini executor',phases,executorRows,error,passed:schedulerRetryLivePassed(phases,executorRows)};
fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/scheduler-retry-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify({root,passed:report.passed,error}));process.exitCode=report.passed?0:1;
