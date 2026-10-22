import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {expect,it} from 'vitest';

function run(root:string,phase:number){
  return new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','scripts/verify-scheduler-retry-child.ts','--synthetic',root,String(phase)],{
      cwd:process.cwd(),env:{...process.env,SWARM_HOME:root},stdio:['ignore','pipe','pipe'],
    });
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Scheduler child timed out: '+output));},20000);
    child.on('error',error=>{clearTimeout(timeout);reject(error);});
    child.on('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(`Scheduler child ${phase} exited ${code}: ${output}`));});
  });
}
it('three actual automatic scheduler launches survive child-process restarts and the fourth is held before executor entry',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-scheduler-retry-'));
  try {
    for(let phase=1;phase<=4;phase++)await run(root,phase);
    const reports=await Promise.all([1,2,3,4].map(async phase=>JSON.parse(await fs.readFile(path.join(root,`phase-${phase}.json`),'utf8'))));
    expect(new Set(reports.map(report=>report.pid)).size).toBe(4);
    expect(reports.map(report=>report.launches.length)).toEqual([1,1,1,0]);
    expect(reports.map(report=>report.reserved)).toEqual([1,2,3,3]);
    expect(reports.every(report=>report.allAutomatic)).toBe(true);
    expect(reports[3].outcomes).toEqual(['failure','failure','failure']);
    expect(new Set(reports[3].scopeKeys).size).toBe(1);
    expect(reports[3].retryHold).toContain('Automatic execution budget reached');
    const launches=(await fs.readFile(path.join(root,'executor-launches.jsonl'),'utf8')).trim().split('\n').map(row=>JSON.parse(row));
    expect(launches).toHaveLength(3);expect(new Set(launches.map(row=>row.id)).size).toBe(3);
    expect(launches.every(row=>typeof row.id==='string'&&row.id.length===36)).toBe(true);
    expect(launches.map(row=>row.id)).toEqual(reports[3].reservationIds);
  }finally{await fs.rm(root,{recursive:true,force:true});}
},80000);
