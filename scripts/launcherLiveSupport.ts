import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {hostSocket,PTY_PROTOCOL,encode,readMessages,type FromHost} from '../server/ptyProtocol.ts';
/** Stop only the keeper authenticated by this newly generated verification home. */
export async function stopVerificationKeeper(home:string,expectedInstance?:string){
 if(!path.basename(path.dirname(home)).startsWith('cubefarm-launcher-live-')||fs.lstatSync(home).isSymbolicLink())throw new Error('Unexpected isolated keeper scope');
 const secretFile=path.join(home,'pty.secret');if(!fs.existsSync(secretFile))return;
 let pid=0;
 await new Promise<void>((resolve,reject)=>{
  const socket=net.createConnection(hostSocket(home));const active=new Set<string>();let stopping=false;
  const timer=setTimeout(()=>{socket.destroy();reject(new Error('Isolated keeper cleanup timed out'));},12000);
  socket.once('error',reject);socket.once('connect',()=>socket.write(encode({op:'hello',version:PTY_PROTOCOL,secret:fs.readFileSync(secretFile,'utf8').trim()})));
  const finish=()=>{if(!active.size&&!stopping){stopping=true;socket.write(encode({op:'shutdown'}));}};
  readMessages<FromHost>(socket,message=>{
   if(message.op==='ready'){
    if(expectedInstance&&message.instance!==expectedInstance){clearTimeout(timer);socket.destroy();reject(new Error('Keeper ownership changed'));return;}
    pid=message.pid??0;
    for(const held of message.ptys)if(held.exit===null){active.add(held.id);socket.write(encode({op:'attach',id:held.id}));socket.write(encode({op:'kill',id:held.id}));}
    finish();
   }else if(message.op==='exit'){active.delete(message.id);finish();}
  });
  socket.once('close',()=>{clearTimeout(timer);if(active.size||!stopping)reject(new Error('Native exit is unverified'));else resolve();});
 });
 for(let i=0;i<100&&pid>0;i++){try{process.kill(pid,0);}catch{return;}await new Promise(resolve=>setTimeout(resolve,50));}
 if(pid>0)throw new Error('Keeper process exit unverified');
}
