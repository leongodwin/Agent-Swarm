import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
/** Synthetic state/native contract binding; never provider evidence. */
export async function bindNativeHandoffFixture(root:string,fixture:{lease:string;bytes:string;input:{snapshotSha256:string}},command:{executable:string;args:string[]}){
 const hash=crypto.createHash('sha256').update(fixture.lease).digest('hex'),state=JSON.parse(fixture.bytes);
 for(const run of state.runs){run.nativeLeaseSha256=hash;for(const operation of run.operations)operation.commandSha256=crypto.createHash('sha256').update(JSON.stringify(command)).digest('hex');}
 fixture.bytes=JSON.stringify(state);fixture.input.snapshotSha256=crypto.createHash('sha256').update(fixture.lease).update('\0').update(fixture.bytes).digest('hex');
 await fs.writeFile(path.join(root,'delivery.json'),fixture.bytes);return hash;
}
