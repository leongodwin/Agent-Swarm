import {afterEach,expect,it,vi} from 'vitest';
import {deliveryCommands} from './delivery.ts';
import {runCapabilityProbe} from './capabilityChecks.ts';
afterEach(()=>vi.restoreAllMocks());
const connection='owned-id  qa@example.test  /providers/Microsoft.PowerApps/apis/shared_teams  Connected';
const check={id:'teams',category:'connector' as const,remedy:'Verify actual connection',probe:{kind:'pac-connection' as const,environmentUrl:'https://synthetic.crm4.dynamics.com',api:'shared_teams',account:'qa@example.test',connectionId:'owned-id'}};
function pendingNative(){const resolvers:Array<(value:string)=>void>=[];vi.spyOn(deliveryCommands,'run').mockImplementation(async(_command,_cwd,_env,signal)=>new Promise<string>((done,reject)=>{resolvers.push(done);signal.addEventListener('abort',()=>reject(new Error('native aborted')),{once:true});}));return ()=>resolvers.forEach(resolve=>resolve(connection));}
it('may coalesce identical native reads when their cancellation ownership is identical',async()=>{
 const finish=pendingNative(),controller=new AbortController();
 const a=runCapabilityProbe(check,'independent-shared-owned',controller.signal),b=runCapabilityProbe(check,'independent-shared-owned',controller.signal);
 const outcomes=Promise.allSettled([a,b]);finish();expect((await outcomes).map(row=>row.status)).toEqual(['fulfilled','fulfilled']);expect(deliveryCommands.run).toHaveBeenCalledTimes(1);
});
it('does not let one caller cancel another caller sharing the same native read',async()=>{
 const finish=pendingNative(),first=new AbortController(),second=new AbortController();
 const a=runCapabilityProbe(check,'independent-shared-first',first.signal),b=runCapabilityProbe(check,'independent-shared-first',second.signal);
 const outcomes=Promise.allSettled([a,b]);first.abort();finish();
 const [one,two]=await outcomes;expect(one.status).toBe('rejected');expect(two.status).toBe('fulfilled');
});
it('honours a joining caller cancellation while preserving another caller native read',async()=>{
 const finish=pendingNative(),first=new AbortController(),second=new AbortController();
 const a=runCapabilityProbe(check,'independent-shared-second',first.signal),b=runCapabilityProbe(check,'independent-shared-second',second.signal);
 const outcomes=Promise.allSettled([a,b]);second.abort();finish();
 const [one,two]=await outcomes;expect(one.status).toBe('fulfilled');expect(two.status).toBe('rejected');
});
