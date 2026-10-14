import {expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import {createConnectorCatalogueObserver,connectorCatalogueObservation} from './connectorCatalogue.ts';
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',input={tenantId:tenant,caller:'tester@company.test',environmentId:`Default-${tenant}`,connectors:['shared_office365','shared_commondataserviceforapps'],checkout:'synthetic'};
function fixture(){
  const account={tenantId:tenant,user:{name:input.caller,type:'user'}};
  const metadata=(name:string)=>({id:`/providers/Microsoft.PowerApps/apis/${name}`,name,type:'Microsoft.PowerApps/apis',properties:{isCustomApi:false,capabilities:['actions'],runtimeUrls:['https://unused.test'],unusedSecret:'private-unused'},unused:'private-unused'});
  const run=vi.fn(async(command:{executable:string;args:string[]})=>JSON.stringify(command.args[0]==='account'?account:metadata(new URL(command.args[command.args.indexOf('--url')+1]).pathname.split('/').pop()!)));
  return {account,metadata,run,observe:createConnectorCatalogueObserver({run})};
}
it('reads each requested connector twice via fixed filtered GET routes with account checks before/after',async()=>{
  const f=fixture(),value=await f.observe(input);expect(value).toMatchObject({status:'observed',complete:false,operationIdsVerified:false,complianceVerified:false,nativeCommands:6,failure:'none'});expect(value.entries.map(row=>row.name)).toEqual(input.connectors.slice().sort());expect(JSON.stringify(value)).not.toContain('private-unused');expect(JSON.stringify(value)).not.toContain('unused.test');
  expect(value.observationSha256).toBe(crypto.createHash('sha256').update(JSON.stringify(value.entries)).digest('hex'));expect(connectorCatalogueObservation.safeParse(value).success).toBe(true);
  for(const [command] of f.run.mock.calls){expect(command.executable).toBe('az');if(command.args[0]==='rest'){const url=new URL(command.args[command.args.indexOf('--url')+1]);expect(url.origin).toBe('https://api.powerplatform.com');expect(url.searchParams.get('$filter')).toBe(`environment eq '${input.environmentId}'`);expect(url.searchParams.get('api-version')).toBe('2024-10-01');expect(command.args).toContain('get');expect(command.args).toContain('https://api.powerplatform.com');}}
});
it.each(['tenant','caller','service-principal'])('denies initial %s identity mismatch before metadata dispatch',async mode=>{
  const f=fixture();if(mode==='tenant')f.account.tenantId=other;if(mode==='caller')f.account.user.name='other@company.test';if(mode==='service-principal')f.account.user.type='servicePrincipal';
  const value=await f.observe(input);expect(value).toMatchObject({status:'unavailable',failure:'identity',entries:[],nativeCommands:1});
});
it.each(['id','name','type','properties','pagination','malformed-json','metadata-drift','final-identity'])('discards partial metadata after %s',async mode=>{
  const f=fixture(),normal=f.run.getMockImplementation()!;let metadataReads=0,profiles=0;
  f.run.mockImplementation(async command=>{
    if(command.args[0]==='account'){if(mode==='final-identity'&&++profiles===2)return JSON.stringify({...f.account,tenantId:other});return normal(command);}
    const name=new URL(command.args[command.args.indexOf('--url')+1]).pathname.split('/').pop()!,value:any=f.metadata(name);metadataReads++;
    if(mode==='id')value.id=`/providers/Microsoft.PowerApps/apis/shared_other`;if(mode==='name')value.name='shared_other';if(mode==='type')value.type='custom/apis';if(mode==='properties')delete value.properties.isCustomApi;if(mode==='pagination')value.nextLink='https://untrusted.test';if(mode==='metadata-drift'&&metadataReads>2)value.properties.isCustomApi=true;
    return mode==='malformed-json'?'private malformed output':JSON.stringify(value);
  });
  const value=await f.observe(input);expect(value.status).toBe('unavailable');expect(value.entries).toEqual([]);expect(value.observationSha256).toBeUndefined();expect(JSON.stringify(value)).not.toContain('private');
});
it('reports missing delegated permissions without exposing raw errors or granting access',async()=>{
  const f=fixture(),normal=f.run.getMockImplementation()!;f.run.mockImplementation(async command=>command.args[0]==='rest'?Promise.reject(new Error('InsufficientDelegatedPermissions private Bearer secret')):normal(command));
  const value=await f.observe(input);expect(value).toMatchObject({status:'unavailable',failure:'delegated-permissions',nativeCommands:2});expect(value.reason).toContain('Connectivity.Connectors.Read');expect(value.reason).toContain('PowerApps.Apps.Manage');expect(JSON.stringify(value)).not.toContain('private');expect(JSON.stringify(value)).not.toContain('Bearer');
});
it('keeps pending native reads owned after cancellation and refuses their late result',async()=>{
  const f=fixture(),controller=new AbortController();let release!:(value:string)=>void;f.run.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));let settled=false;
  const pending=f.observe({...input,signal:controller.signal}).then(value=>{settled=true;return value;});await Promise.resolve();controller.abort();await Promise.resolve();expect(settled).toBe(false);release(JSON.stringify(f.account));expect(await pending).toMatchObject({status:'unavailable',failure:'cancelled'});expect(f.run).toHaveBeenCalledOnce();
});
it('bounds provider output and rejects unsafe, duplicate or excessive requested IDs before dispatch',async()=>{
  const f=fixture();f.run.mockResolvedValue('x'.repeat(2*1024*1024+1));expect(await f.observe(input)).toMatchObject({status:'unavailable',failure:'limit'});
  f.run.mockClear();for(const connectors of [[],['../unsafe'],['shared_a','shared_a'],Array.from({length:11},(_,i)=>`shared_${i}`)])await expect(f.observe({...input,connectors})).rejects.toThrow();expect(f.run).not.toHaveBeenCalled();
});
it.each(['digest','requested','duplicate','unavailable-facts','failed-success'])('rejects contradictory %s catalogue receipts at the consumer boundary',async mode=>{
  const value=await fixture().observe(input);if(mode==='digest')value.observationSha256='a'.repeat(64);if(mode==='requested')value.requested=['shared_other'];if(mode==='duplicate')value.entries[1]=value.entries[0];if(mode==='unavailable-facts')value.status='unavailable';if(mode==='failed-success')value.failure='provider';
  expect(connectorCatalogueObservation.safeParse(value).success).toBe(false);
});
