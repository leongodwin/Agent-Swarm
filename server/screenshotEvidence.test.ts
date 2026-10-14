import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {newScreenshots,readScreenshot,screenshotFile} from './agentRunner.ts';
const roots:string[]=[];const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=','base64');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'swarm-shot-evidence-'));roots.push(root);const file=path.join(root,'valid.png');fs.writeFileSync(file,png);return {root,file};}
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('captures contained PNG bytes and refuses traversal to a sibling evidence root',()=>{
  const a=fixture(),b=fixture();expect(readScreenshot(a.root,a.file)).toEqual({data:png,mime:'image/png'});
  expect(readScreenshot(a.root,b.file)).toBeNull();expect(screenshotFile(a.root,`[shot](${path.relative(a.root,b.file).replaceAll('\\','/')})`)).toBeNull();
});
it('rejects directories, empty files, wrong signatures and oversized sparse files',()=>{
  const {root}=fixture();for(const [name,data] of [['empty.png',Buffer.alloc(0)],['false.png',Buffer.from('private text')],['false.jpg',png]] as const){const file=path.join(root,name);fs.writeFileSync(file,data);expect(readScreenshot(root,file)).toBeNull();}
  const directory=path.join(root,'directory.png');fs.mkdirSync(directory);expect(readScreenshot(root,directory)).toBeNull();
  const large=path.join(root,'large.png');fs.writeFileSync(large,png);fs.truncateSync(large,10*1024*1024+1);expect(readScreenshot(root,large)).toBeNull();
  expect(newScreenshots(root,new Set(),Infinity).map(item=>item.name)).not.toContain('large.png');
});
it('rejects an evidence file replaced between discovery and capture',()=>{
  const {root,file}=fixture();const discovered=newScreenshots(root,new Set(),Infinity);expect(discovered).toHaveLength(1);
  fs.writeFileSync(file,'private replacement');expect(readScreenshot(root,discovered[0].file)).toBeNull();
});
it('rejects growth during the bounded read and closes the opened descriptor',()=>{
  const {root,file}=fixture(),original=fs.readSync.bind(fs),close=vi.spyOn(fs,'closeSync');let changed=false;
  vi.spyOn(fs,'readSync').mockImplementation(((...args:any[])=>{if(!changed){changed=true;fs.appendFileSync(file,'extra');}return (original as any)(...args);}) as typeof fs.readSync);
  expect(readScreenshot(root,file)).toBeNull();expect(close).toHaveBeenCalled();
});
it('rejects an outside directory junction on Windows or directory symlink on POSIX',()=>{
  const a=fixture(),b=fixture(),link=path.join(a.root,'linked');fs.symlinkSync(b.root,link,process.platform==='win32'?'junction':'dir');
  expect(readScreenshot(a.root,path.join(link,'valid.png'))).toBeNull();
});
