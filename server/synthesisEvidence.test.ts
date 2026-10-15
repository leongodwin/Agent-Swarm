import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {afterEach,it,expect} from 'vitest';import {captureSynthesisEvidence,verifySynthesisEvidence} from './synthesisEvidence.ts';import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
it('captures exact referenced text, refuses outside/changed/oversized sources and detects later drift',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthesis-evidence-'));roots.push(root);const allowed=path.join(root,'approved');await fs.mkdir(allowed);
 const files=['contract.md','../outside.md','changed.md','oversized.md'];const refs=[];
 for(const file of files){const target=path.join(allowed,file),text=file==='oversized.md'?'x'.repeat(33000):'Synthetic contract: phase grant, no DELETE, fixed comparison fields.';await fs.writeFile(target,text);refs.push({reference:target,sha256:crypto.createHash('sha256').update(text).digest('hex')});}
 await fs.writeFile(path.join(allowed,'changed.md'),'Changed bytes');const record={content:{findings:[{evidence:refs}]}} as unknown as DeliveryRecord;
 const result=await captureSynthesisEvidence(record,[allowed]);expect(result.map(row=>row.status)).toEqual(['captured','unavailable','unavailable','unavailable']);expect(result[0].text).toContain('phase grant');await verifySynthesisEvidence(result);
 await fs.writeFile(path.join(allowed,'contract.md'),'Late mutation');await expect(verifySynthesisEvidence(result)).rejects.toThrow('changed during synthesis');
});
