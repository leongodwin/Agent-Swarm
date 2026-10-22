// Run after build-server.mjs. Exercise the reader from the packaged directory,
// where import.meta.url differs from the source test runner.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const target=path.join(root,'dist-server',`.contract-reader-${crypto.randomUUID()}.mjs`);
try{
 await build({entryPoints:[path.join(root,'server','deliverySourceRead.ts')],outfile:target,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
 const {readDeliverySource}=await import(pathToFileURL(target).href);
 // Exercise the actual bootstrap guard's fixed source list, including files
 // which the public reader intentionally does not expose.
 const runtime=await fs.readFile(path.join(root,'server','schemaBootstrapRuntime.ts'),'utf8');
 const declaration=/const codeFiles=(\[[^\]]+\]);/.exec(runtime);
 assert.ok(declaration,'Bootstrap source catalogue must be discoverable');
 const files=JSON.parse(declaration[1].replaceAll("'",'"'));
 assert.ok(files.length>3);
 for(const file of files){
  assert.match(file,/^[a-zA-Z][a-zA-Z0-9]*\.ts$/);
  assert.deepEqual(await fs.readFile(path.join(root,'dist-server',file)),await fs.readFile(path.join(root,'server',file)));
 }
 for(const [document,file] of [['DELIVERY-PERMISSIONS-CONTRACT','deliveryPermissions.ts'],['SHAREPOINT-SCHEMA-CONTRACT','sharepointProvisioning.ts'],['SCHEMA-BOOTSTRAP-CONTRACT','schemaBootstrap.ts'],['SHAREPOINT-TARGET-CONTRACT','sharepointWriteReadiness.ts']]){
  const expected=await fs.readFile(path.join(root,'server',file),'utf8');
  const result=await readDeliverySource({kind:'office-document',document,maxLines:2},{repoId:'bundle-smoke',sourceCommit:null,read:async()=>{throw Error('Unexpected repository read');},guard(){}});
  assert.equal(result.scope,'approved-office-contract');
  assert.equal(result.sha256,crypto.createHash('sha256').update(expected).digest('hex'));
  assert.equal(result.content,expected.split('\n').slice(0,2).join('\n'));
 }
 console.log(`Bundled office reader: four contract hashes/pages and all ${files.length} bootstrap source assets verified`);
}finally{await fs.unlink(target).catch(()=>{});}
