import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {afterEach,expect,it} from 'vitest';
import {verifyStandaloneBuildIdentity} from './standaloneBuildIdentity.ts';
const roots:string[]=[],head='a'.repeat(40),temp=await fs.realpath(os.tmpdir());
afterEach(async()=>{for(const root of roots.splice(0)){if(!root.startsWith(temp+path.sep)||!path.basename(root).startsWith('swarm-build-proof-'))throw Error('Unexpected test cleanup path');await fs.rm(root,{recursive:true,force:true,maxRetries:5});}});
async function fixture(){const root=await fs.mkdtemp(path.join(temp,'swarm-build-proof-'));roots.push(root);const folder=path.join(root,'dist-server');await fs.mkdir(folder);const entry=path.join(folder,'index.js'),proof=path.join(folder,'standalone-build-identity.json');await build({entryPoints:[fileURLToPath(new URL('./standaloneBuildIdentity.ts',import.meta.url))],outfile:entry,bundle:true,platform:'node',format:'esm',logLevel:'silent'});const entrySha256=crypto.createHash('sha256').update(await fs.readFile(entry)).digest('hex'),value={schemaVersion:1,head,clean:true,entrySha256};await fs.writeFile(proof,JSON.stringify(value));const loaded=await import(pathToFileURL(entry).href);return{entry,proof,value,verify:()=>loaded.verifyStandaloneBuildIdentity(head)};}
it('admits the actual loaded bundle only with a matching clean-source build identity',async()=>{const f=await fixture();expect(f.verify()).toEqual({head,entrySha256:f.value.entrySha256});});
it.each(['dirty','head','digest','changed-bundle','missing','hardlink','directory','oversize','json','extra'])('rejects %s build proof before source integration can grant authority',async mode=>{const f=await fixture();if(mode==='dirty')f.value.clean=false;if(mode==='head')f.value.head='b'.repeat(40);if(mode==='digest')f.value.entrySha256='b'.repeat(64);await fs.writeFile(f.proof,JSON.stringify({...f.value,...mode==='extra'?{operatorApproval:true}:{}}));if(mode==='changed-bundle')await fs.appendFile(f.entry,'\n// a later build cannot relabel this loaded process\n');if(mode==='missing')await fs.unlink(f.proof);if(mode==='hardlink')await fs.link(f.proof,f.proof+'.alias');if(mode==='directory'){await fs.unlink(f.proof);await fs.mkdir(f.proof);}if(mode==='oversize')await fs.writeFile(f.proof,'x'.repeat(2049));if(mode==='json')await fs.writeFile(f.proof,'invalid JSON');expect(()=>f.verify()).toThrow();});
it('refuses source-mode execution instead of treating a working tree as a loaded production build',()=>expect(()=>verifyStandaloneBuildIdentity(head)).toThrow('normal built server'));
