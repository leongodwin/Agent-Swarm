import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {readWorkerCanvasSnapshot,nativeCanvasSyncCount} from './workerCanvasSnapshot.ts';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-snapshot-'));roots.push(directory);fs.writeFileSync(path.join(directory,'App.pa.yaml'),'App: {}');return directory;}
it('returns exact source bytes and hashes without interpreting source as instructions',()=>{const d=fixture(),s=readWorkerCanvasSnapshot(d,1);expect(s.files).toMatchObject([{file:'App.pa.yaml',content:'App: {}',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}]);});
it.each(['partial','extra-file','oversize','invalid-utf8','binary','linked-file','linked-directory'] as const)('refuses %s source without truncation or outside reads',mode=>{
 let d=fixture();if(mode==='partial')fs.writeFileSync(path.join(d,'Screen1.pa.yaml'),'Screen');if(mode==='extra-file')fs.writeFileSync(path.join(d,'notes.md'),'private');if(mode==='oversize')fs.writeFileSync(path.join(d,'App.pa.yaml'),'a'.repeat(49*1024));if(mode==='invalid-utf8')fs.writeFileSync(path.join(d,'App.pa.yaml'),Buffer.from([0xff]));if(mode==='binary')fs.writeFileSync(path.join(d,'App.pa.yaml'),'a\0b');
 if(mode==='linked-file'){const other=fixture();fs.unlinkSync(path.join(d,'App.pa.yaml'));fs.symlinkSync(path.join(other,'App.pa.yaml'),path.join(d,'App.pa.yaml'));}if(mode==='linked-directory'){const other=fixture(),link=path.join(other,'linked');fs.symlinkSync(d,link,'junction');d=link;}
 expect(()=>readWorkerCanvasSnapshot(d,1)).toThrow();
});
it('captures an authored screen larger than the old limit with exact full bytes',()=>{
 const d=fixture(),content='Screen1:\n  Description: '+ 'x'.repeat(40*1024);fs.writeFileSync(path.join(d,'Screen1.pa.yaml'),content);
 const snapshot=readWorkerCanvasSnapshot(d,2);expect(snapshot.files.find(f=>f.file==='Screen1.pa.yaml')).toEqual({file:'Screen1.pa.yaml',content,sha256:crypto.createHash('sha256').update(content).digest('hex')});
});
it.each(['aggregate','encoded','utf8'] as const)('retains the bounded receipt for %s expansion without truncation',mode=>{
 const d=fixture();if(mode==='aggregate'){fs.writeFileSync(path.join(d,'App.pa.yaml'),'a'.repeat(26*1024));fs.writeFileSync(path.join(d,'Screen1.pa.yaml'),'b'.repeat(26*1024));}
 if(mode==='encoded')fs.writeFileSync(path.join(d,'App.pa.yaml'),'"'.repeat(25*1024));
 if(mode==='utf8')fs.writeFileSync(path.join(d,'App.pa.yaml'),'€'.repeat(17*1024));
 expect(()=>readWorkerCanvasSnapshot(d,mode==='aggregate'?2:1)).toThrow();
});
it('requires an exact single native success reply tied to the office directory',()=>{
 const directory=fixture(),text=`Synced 1 file(s) to ${directory}`,reply={content:[{type:'text',text}]};expect(nativeCanvasSyncCount(reply,directory)).toBe(1);
 for(const response of [{...reply,isError:true},{...reply,structuredContent:{ok:true}},{content:[...reply.content,{type:'text',text:'error'}]},{content:[{type:'text',text:'prefix '+text}]}])expect(nativeCanvasSyncCount(response,directory)).toBeNull();expect(nativeCanvasSyncCount(reply,path.join(directory,'other'))).toBeNull();
});
