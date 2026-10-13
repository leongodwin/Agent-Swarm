import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {generateHldContent} from '../shared/hld.ts';
import {saveHldArtifact,loadLatestHld} from './hldArtifacts.ts';
import {HttpError} from './httpError.ts';
const roots:string[]=[];
const input={solutionName:'Synthetic receipt solution',problemContext:'Preserve receipt audit history',components:[{title:'Receipt app',role:'Maker',badge:'Canvas',details:'Capture receipts',deliverables:['Expense.msapp']}]};
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function root(){const value=await fs.mkdtemp(path.join(os.tmpdir(),'hld-artifacts-'));roots.push(value);return value;}
it('reloads the exact structured requirements, plan and diagrams and preserves prior versions and unmanaged HLD',async()=>{
  const repo=await root();const legacy=path.join(repo,'docs','architecture','HLD.md');await fs.mkdir(path.dirname(legacy),{recursive:true});await fs.writeFile(legacy,'User-authored architecture');
  const first=generateHldContent(input),secondInput={...input,problemContext:'Changed reviewed requirements'},second=generateHldContent(secondInput);
  const saved=await saveHldArtifact(repo,input,first,()=>{},'synthetic/repo');expect((await loadLatestHld(repo,()=>{},'synthetic/repo'))).toMatchObject({repoId:'synthetic/repo',input,result:first,sha256:saved.artifactSha256});
  await saveHldArtifact(repo,secondInput,second,()=>{},'synthetic/repo');expect((await loadLatestHld(repo))?.result.docId).toBe(second.docId);
  expect(await fs.readFile(saved.savedFilePath!,'utf8')).toBe(first.markdownContent);expect(await fs.readFile(legacy,'utf8')).toBe('User-authored architecture');
  await expect(loadLatestHld(repo,()=>{},'different/repo')).rejects.toThrow('another repository');
  await expect(saveHldArtifact(repo,input,first,()=>{},'synthetic/repo')).rejects.toThrow('identity already exists');
});
it('returns absent without creating directories and rejects a corrupt index without overwriting it',async()=>{
  const repo=await root();expect(await loadLatestHld(repo)).toBeNull();expect(await fs.readdir(repo)).toEqual([]);
  const dir=path.join(repo,'docs','architecture','drafts');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'current.json'),'invalid index');
  await expect(loadLatestHld(repo)).rejects.toThrow('unreadable');await expect(saveHldArtifact(repo,input,generateHldContent(input))).rejects.toThrow('unreadable');expect(await fs.readFile(path.join(dir,'current.json'),'utf8')).toBe('invalid index');
});
it.each(['markdown','artifact','identity'])('rejects modified saved evidence: %s',async changed=>{
  const repo=await root();const saved=await saveHldArtifact(repo,input,generateHldContent(input));
  const dir=path.dirname(saved.savedFilePath!);if(changed==='markdown')await fs.writeFile(saved.savedFilePath!,'changed text');
  else {const file=saved.savedFilePath!.replace(/\.md$/,'.json');const artifact=JSON.parse(await fs.readFile(file,'utf8'));if(changed==='artifact')artifact.input.problemContext='changed inputs';else artifact.result.docId='HLD-11111111-1111-4111-8111-111111111111';await fs.writeFile(file,JSON.stringify(artifact));}
  await expect(loadLatestHld(repo)).rejects.toThrow(/differs/);expect(await fs.readdir(dir)).toContain('current.json');
});
it('keeps the previous verified pointer after failed publication or shutdown mid-save',async()=>{
  const repo=await root();const original=generateHldContent(input);await saveHldArtifact(repo,input,original);
  const rename=fs.rename.bind(fs);const mock=vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{if(String(to).endsWith('current.json'))throw new Error('synthetic publication failure');return rename(from,to);});
  await expect(saveHldArtifact(repo,input,generateHldContent(input))).rejects.toThrow('publication failure');mock.mockRestore();expect((await loadLatestHld(repo))?.result.docId).toBe(original.docId);
  let closed=false;vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{await rename(from,to);if(String(to).endsWith('.md'))closed=true;});
  await expect(saveHldArtifact(repo,input,generateHldContent(input),()=>{if(closed)throw new HttpError(503,'closed');})).rejects.toThrow('closed');expect((await loadLatestHld(repo))?.result.docId).toBe(original.docId);
});
it('serializes simultaneous saves so every version reloads intact',async()=>{
  const repo=await root();const completed:string[]=[];const results=await Promise.all(Array.from({length:4},()=>saveHldArtifact(repo,input,generateHldContent(input)).then(result=>{completed.push(result.docId);return result;})));
  expect((await loadLatestHld(repo))?.result.docId).toBe(completed.at(-1));for(const result of results)expect(await fs.readFile(result.savedFilePath!,'utf8')).toBe(result.markdownContent);
});
it('rejects an escaping parent before creating a directory outside the checkout',async()=>{
  const repo=await root(),outside=await root();await fs.symlink(outside,path.join(repo,'docs'),process.platform==='win32'?'junction':'dir');
  await expect(saveHldArtifact(repo,input,generateHldContent(input))).rejects.toThrow('inside the repository');expect(await fs.readdir(outside)).toEqual([]);
});
