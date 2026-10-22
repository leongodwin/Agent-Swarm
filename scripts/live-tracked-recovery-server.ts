/** Production HTTP recovery surface in an isolated integration host. Unused
 * office services are absent; this is not a launched/full operating office. */
import path from 'node:path';
import os from 'node:os';
import {DeliveryService} from '../server/delivery.ts';
import {createOfficeHttpApp,type OfficeHttpServices} from '../server/officeHttp.ts';
import {createTenancyService} from '../server/tenancy.ts';
import {atomicWrite} from '../server/atomicFile.ts';
const root=path.resolve(process.argv[2]);
const delivery=new DeliveryService(root,false);await delivery.init({allowUnavailable:true});delivery.setDraining(true);
// Read the real shared auth ownership evidence. The coordinator makes no
// login/profile-select calls. Missing evidence uses production store semantics.
const tenancy=createTenancyService(false,undefined,path.join(os.homedir(),'.cubefarm'));
const host=createOfficeHttpApp({backend:{demo:false,tenancy},swarm:{isDraining:true,snapshot:()=>({repos:[]})},features:{},capabilities:{},delivery,toolGovernance:{},tenantDlp:{},canvasOwnership:{},homeDir:root,runtimeStartedAt:new Date().toISOString(),policyReaderMode:'direct'} as unknown as OfficeHttpServices);
const server=host.app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();if(!address||typeof address==='string')throw new Error('No owned HTTP listener');
await atomicWrite(path.join(root,'recovery-server-ready.json'),JSON.stringify({pid:process.pid,port:address.port,available:delivery.available,draining:delivery.isDraining,authOwnership:tenancy.activity().profileMutation}));
let closing=false;async function close(){if(closing)return;closing=true;host.closeAdmission();await delivery.close();await tenancy.shutdown();server.close(()=>process.exit(0));}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(String(value).trim()==='close')void close();});
