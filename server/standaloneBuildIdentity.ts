import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
const entry=fileURLToPath(import.meta.url),digest=(bytes:Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
const bundled=path.basename(entry)==='index.js'&&path.basename(path.dirname(entry))==='dist-server';
// Capture the loaded bundle once. A later checkout/build cannot relabel an old
// running process as the newly integrated code.
const loaded=bundled?digest(fs.readFileSync(entry)):null;
export function verifyStandaloneBuildIdentity(head:string){
 if(!loaded)throw Error('Standalone execution requires the normal built server');
 const file=path.join(path.dirname(entry),'standalone-build-identity.json'),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>2048||fs.realpathSync(file)!==path.resolve(file))throw Error('Canonical bounded build identity required');
 const proof=z.strictObject({schemaVersion:z.literal(1),head:z.string().regex(/^[a-f0-9]{40}$/),clean:z.literal(true),entrySha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(JSON.parse(fs.readFileSync(file,'utf8')));
 if(proof.head!==head||proof.entrySha256!==loaded||digest(fs.readFileSync(entry))!==loaded)throw Error('Loaded server build does not match the integrated source');
 return{head:proof.head,entrySha256:loaded};
}
