import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import config from '../vitest.config.ts';

it('gives security fixtures a native canonical temp root, including Windows short-name aliases',()=>{
 const configured=config.test!.env!;
 for(const key of ['TEMP','TMP','TMPDIR'])expect(configured[key]).toBe(fs.realpathSync.native(os.tmpdir()));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canonical-fixture-'));
 try{expect(fs.realpathSync.native(root)).toBe(path.resolve(root));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('passes the same canonical root to native fixture children',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['-e',`const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'canonical-child-'));try{console.log(JSON.stringify({root,actual:fs.realpathSync.native(root)}));}finally{fs.rmSync(root,{recursive:true,force:true});}`],{env:{...process.env,...config.test!.env},windowsHide:true,encoding:'utf8'}));
 expect(result.root).toBe(result.actual);
});
