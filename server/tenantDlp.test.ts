import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TenantDlpService, verifyTenantSnapshot, type StartPolicyReader } from './tenantDlp.ts';
import { atomicWrite } from './atomicFile.ts';

const identity = {tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',caller:'leon@graspai.co.uk'};
const now = Date.parse('2026-10-13T00:20:00.000Z');
const snapshot = () => ({...identity,schemaVersion:1,observedAt:new Date(now).toISOString(),source:'Get-DlpPolicy module route',moduleVersion:'2.0.219',scope:'standard-policy-inventory',complete:true,pages:1,policies:[]});
const roots:string[]=[]; const services:TenantDlpService[]=[];
afterEach(async()=>{await Promise.all(services.splice(0).map(service=>service.close()));vi.useRealTimers();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function fixture(start?:StartPolicyReader) { const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-policy-reader-'));roots.push(root);const service=new TenantDlpService(root,start,()=>now);services.push(service);await service.init();return {root,service}; }
it('accepts complete empty observations while rejecting mismatched, partial, stale and malformed inventories',()=>{
  expect(verifyTenantSnapshot(snapshot(),identity,now).policies).toEqual([]);
  expect(verifyTenantSnapshot({...snapshot(),tenantId:identity.tenantId.toUpperCase(),caller:identity.caller.toUpperCase()},identity,now).pages).toBe(1);
  for(const bad of [{...snapshot(),tenantId:'11111111-1111-4111-8111-111111111111'},{...snapshot(),caller:'other@company.test'},{...snapshot(),complete:false},{...snapshot(),pages:101},{...snapshot(),observedAt:new Date(now-900001).toISOString()},{...snapshot(),observedAt:new Date(now+30001).toISOString()},{...snapshot(),policies:{error:'403'}},{...snapshot(),token:'sensitive'}]) expect(()=>verifyTenantSnapshot(bad,identity,now)).toThrow();
});
it('reuses a warm authenticated reader and exposes zero policies without certifying compliance',async()=>{
  let report!:(value:unknown)=>void;const refresh=vi.fn(),stop=vi.fn();
  const start=vi.fn<StartPolicyReader>((_identity,result,_ended,initialId)=>{let requestId=initialId;report=value=>result(value,requestId);refresh.mockImplementation(id=>{requestId=id;});return {refresh,stop};});
  const {service,root}=await fixture(start);
  expect(service.view()).toMatchObject({status:'unavailable',complianceVerified:false});
  expect(service.refresh(identity).status).toBe('reading');
  expect(()=>service.refresh(identity)).toThrow('already pending');
  report({status:'observed',snapshot:snapshot()});await service.settled();
  expect(service.view()).toMatchObject({status:'observed',policyCount:0,complianceVerified:false,caller:identity.caller});expect(service.view().fingerprint).toMatch(/^[a-f0-9]{64}$/);
  service.refresh(identity);expect(start).toHaveBeenCalledTimes(1);expect(refresh).toHaveBeenCalledTimes(1);
  report({status:'observed',snapshot:{...snapshot(),policies:[{name:'policy',environmentType:'OnlyEnvironments',unknownFutureRule:true}]}});await service.settled();
  expect(service.view().policyCount).toBe(1);
  const restored=new TenantDlpService(root,start,()=>now+900001);services.push(restored);await restored.init();expect(restored.view().status).toBe('stale');
  await service.close();expect(stop).toHaveBeenCalledTimes(1);expect(()=>service.refresh(identity)).toThrow('closed');
});
it('retains previous evidence on reader failure, rejects wrong identities and switches reader ownership',async()=>{
  const callbacks:Array<(value:unknown)=>void>=[];const stops:Array<ReturnType<typeof vi.fn>>=[];
  const {service}=await fixture((_identity,result,_ended,initialId)=>{let requestId=initialId;callbacks.push(value=>result(value,requestId));const stop=vi.fn();stops.push(stop);return {refresh:vi.fn(id=>{requestId=id;}),stop};});
  service.refresh(identity);callbacks[0]({status:'observed',snapshot:snapshot()});await service.settled();
  service.refresh(identity);callbacks[0]({status:'unavailable',reason:'secret provider token'});await service.settled();
  expect(service.view()).toMatchObject({status:'unavailable',policyCount:0});expect(JSON.stringify(service.view())).not.toContain('secret');
  const other={...identity,caller:'other@company.test'};service.refresh(other);expect(stops[0]).toHaveBeenCalledOnce();
  callbacks[0]({status:'observed',snapshot:snapshot()});await service.settled();expect(service.view().status).toBe('reading');
  callbacks[1]({status:'observed',snapshot:snapshot()});await service.settled();expect(service.view().status).toBe('unavailable');expect(service.view().policyCount).toBeUndefined();
});
it('preserves corrupt evidence and refuses to report observations that cannot be persisted',async()=>{
  const {root}=await fixture();const file=path.join(root,'tenant-dlp.json');await fs.writeFile(file,'original damaged evidence');
  const damaged=new TenantDlpService(root);services.push(damaged);await damaged.init();expect(()=>damaged.refresh(identity)).toThrow('corrupted');expect(await fs.readFile(file,'utf8')).toBe('original damaged evidence');
  let report!:(value:unknown)=>void;const good=await fixture((_identity,result,_ended,requestId)=>{report=value=>result(value,requestId);return {refresh:vi.fn(),stop:vi.fn()};});await fs.mkdir(path.join(good.root,'tenant-dlp.json'));
  good.service.refresh(identity);report({status:'observed',snapshot:snapshot()});await good.service.settled();expect(good.service.view().status).toBe('unavailable');expect(good.service.view().policyCount).toBeUndefined();
});
it('fails safely on start errors, process loss, expiry and late responses',async()=>{
  const broken=await fixture(()=>{throw new Error('secret startup detail');});expect(broken.service.refresh(identity).status).toBe('unavailable');
  vi.useFakeTimers();let ended!:()=>void;let report!:(value:unknown)=>void;const stop=vi.fn();
  const {service}=await fixture((_identity,result,end,requestId)=>{report=value=>result(value,requestId);ended=end;return {refresh:vi.fn(),stop};});
  service.refresh(identity);ended();expect(service.view().status).toBe('unavailable');
  service.refresh(identity);await vi.advanceTimersByTimeAsync(600000);expect(service.view().status).toBe('unavailable');expect(stop).toHaveBeenCalled();
  report({status:'observed',snapshot:snapshot()});await service.settled();expect(service.view().status).toBe('unavailable');
});
it('rejects responses and termination from a replaced reader for the same identity',async()=>{
  const readers:Array<{report:(value:unknown,id:string)=>void;end:()=>void;id:string;stop:ReturnType<typeof vi.fn>}>=[];
  const {service}=await fixture((_identity,report,end,id)=>{const stop=vi.fn();readers.push({report,end,id,stop});return {refresh:vi.fn(),stop};});
  service.refresh(identity);readers[0].end();service.refresh(identity);
  readers[0].report({status:'observed',snapshot:snapshot()},readers[1].id);
  readers[0].end();await service.settled();expect(service.view().status).toBe('reading');
  readers[1].report({status:'observed',snapshot:snapshot()},readers[1].id);await service.settled();
  expect(service.view().status).toBe('observed');
});
it('requires the current request ID even when refreshing the same warm reader',async()=>{
  let report!:(value:unknown,id:string)=>void;let initialId='';const refresh=vi.fn();
  const {service}=await fixture((_identity,result,_ended,id)=>{report=result;initialId=id;return {refresh,stop:vi.fn()};});
  service.refresh(identity);report({status:'observed',snapshot:snapshot()},initialId);await service.settled();
  service.refresh(identity);const currentId=refresh.mock.calls[0][0];expect(currentId).not.toBe(initialId);
  report({status:'unavailable'},initialId);report({status:'observed',snapshot:snapshot()},initialId);
  await service.settled();expect(service.view().status).toBe('reading');
  report({status:'observed',snapshot:{...snapshot(),policies:[{name:'current'}]}},currentId);await service.settled();
  expect(service.view()).toMatchObject({status:'observed',policyCount:1});
});
it('handles synchronous reader termination without retaining its handle or accepting its result',async()=>{
  const stop=vi.fn();
  const {service}=await fixture((_identity,report,end,id)=>{report({status:'observed',snapshot:snapshot()},id);end();return {pid:123,refresh:vi.fn(),stop};});
  expect(service.refresh(identity).status).toBe('unavailable');await service.settled();
  expect(service.view().readerPid).toBeUndefined();expect(stop).toHaveBeenCalledOnce();expect(service.view().status).toBe('unavailable');
});
it('revokes queued persistence on expiry without clearing or overwriting a replacement request',async()=>{
  vi.useFakeTimers();const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-policy-owner-'));roots.push(root);
  const reports:Array<{report:(value:unknown,id:string)=>void;id:string}>=[];
  let release!:()=>void;let writing!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{writing=resolve;});let first=true;
  const service=new TenantDlpService(root,(_identity,report,_end,id)=>{reports.push({report,id});return {refresh:vi.fn(),stop:vi.fn()};},()=>now,async(file,data,owns)=>{
    if(first){first=false;writing();await blocked;}await atomicWrite(file,data,owns);
  });services.push(service);await service.init();
  await fs.writeFile(path.join(root,'tenant-dlp.json'),'previous evidence');
  service.refresh(identity);reports[0].report({status:'observed',snapshot:snapshot()},reports[0].id);await started;
  await vi.advanceTimersByTimeAsync(600000);service.refresh(identity);
  release();await service.settled();
  expect(service.view().status).toBe('reading');expect(await fs.readFile(path.join(root,'tenant-dlp.json'),'utf8')).toBe('previous evidence');
  reports[1].report({status:'observed',snapshot:{...snapshot(),policies:[{name:'replacement'}]}},reports[1].id);await service.settled();
  expect(service.view()).toMatchObject({status:'observed',policyCount:1});
  expect(JSON.parse(await fs.readFile(path.join(root,'tenant-dlp.json'),'utf8')).policies).toEqual([{name:'replacement'}]);
});
it('shares an identity-bound fresh read, preserves independent results and forces subsequent stage reads',async()=>{
  let report!:(value:unknown)=>void;const refresh=vi.fn(),start=vi.fn<StartPolicyReader>((_identity,result,_end,initialId)=>{
    let id=initialId;report=value=>result(value,id);refresh.mockImplementation(next=>{id=next;});return {refresh,stop:vi.fn()};
  });
  const {service}=await fixture(start);
  const first=service.ensureObservation(identity,{force:true}),second=service.ensureObservation({...identity,caller:identity.caller.toUpperCase()},{force:true});
  expect(start).toHaveBeenCalledOnce();report({status:'observed',snapshot:snapshot()});await service.settled();
  const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);expect(a).not.toBe(b);
  await service.ensureObservation(identity);expect(refresh).not.toHaveBeenCalled();
  const forced=service.ensureObservation(identity,{force:true});expect(refresh).toHaveBeenCalledOnce();
  report({status:'observed',snapshot:{...snapshot(),policies:[{name:'fresh-stage'}]}});await service.settled();expect((await forced).policies).toEqual([{name:'fresh-stage'}]);
});
it('joins manual discovery and rejects another identity without taking over its reader',async()=>{
  let report!:(value:unknown)=>void;const stop=vi.fn();const {service}=await fixture((_identity,result,_end,id)=>{report=value=>result(value,id);return {refresh:vi.fn(),stop};});
  service.refresh(identity);const joined=service.ensureObservation(identity,{force:true});
  await expect(service.ensureObservation({...identity,caller:'other@company.test'},{force:true})).rejects.toThrow('another tenant or account');
  expect(stop).not.toHaveBeenCalled();report({status:'observed',snapshot:snapshot()});await service.settled();expect((await joined).caller).toBe(identity.caller);
});
it('cancels only the requesting waiter while another check can complete discovery',async()=>{
  let report!:(value:unknown)=>void;const stop=vi.fn();const {service}=await fixture((_identity,result,_end,id)=>{report=value=>result(value,id);return {refresh:vi.fn(),stop};});
  const controller=new AbortController();const cancelled=service.ensureObservation(identity,{signal:controller.signal,force:true});
  const cancellation=expect(cancelled).rejects.toThrow('cancelled');const other=service.ensureObservation(identity,{force:true});controller.abort();await cancellation;
  expect(stop).not.toHaveBeenCalled();expect(service.view().status).toBe('reading');
  report({status:'observed',snapshot:snapshot()});await service.settled();expect((await other).pages).toBe(1);
  const aborted=new AbortController();aborted.abort();await expect(service.ensureObservation(identity,{signal:aborted.signal})).rejects.toThrow('cancelled');
});
it('bounds waits without promoting late evidence to the expired waiter and rejects closure and provider failure',async()=>{
  vi.useFakeTimers();let report!:(value:unknown)=>void;const {service}=await fixture((_identity,result,_end,initialId)=>{let id=initialId;report=value=>result(value,id);return {refresh:vi.fn(next=>{id=next;}),stop:vi.fn()};});
  const timed=service.ensureObservation(identity,{force:true,timeoutMs:5});const expired=expect(timed).rejects.toThrow('expired');
  await vi.advanceTimersByTimeAsync(5);await expired;
  report({status:'observed',snapshot:snapshot()});await service.settled();expect(service.view().status).toBe('observed');
  await expect(service.ensureObservation(identity,{timeoutMs:Infinity})).rejects.toThrow();
  const failed=service.ensureObservation(identity,{force:true});const failure=expect(failed).rejects.toThrow('discovery or evidence persistence');
  report({status:'unavailable'});await service.settled();await failure;
  const closing=service.ensureObservation(identity,{force:true});const closed=expect(closing).rejects.toThrow('closed');
  await service.close();await closed;
});
it.runIf(process.platform==='win32')('runs the actual correlated PowerShell loop and stops on unsupported commands',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-policy-protocol-'));roots.push(root);const script=path.join(root,'protocol-test.ps1');
  const initial='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222';
  await fs.writeFile(script,String.raw`param([string]$Reader,[string]$Initial)
$ErrorActionPreference='Stop'
# Synthetic module/provider functions: no authentication or tenant request is made.
function Import-Module { param($Name,$RequiredVersion,[switch]$DisableNameChecking,$WarningAction) }
function Add-PowerAppsAccount { param($TenantID,$UseSystemBrowser)
 $global:currentSession=@{loggedIn=$true;tenantId=$TenantID;upn='leon@graspai.co.uk'}
}
$global:testReads=0
function InvokeApiNoParseContent { param($Route,$Method,[switch]$ThrowOnFailure)
 if($Method -ne 'GET' -or -not $ThrowOnFailure) { throw 'Unexpected mutation' }
 $global:testReads++
 return [pscustomobject]@{StatusCode=200;Content=('{"value":[{"name":"read-'+$global:testReads+'"}]}')}
}
& $Reader -TenantId '5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c' -ExpectedUser 'leon@graspai.co.uk' -RequestId $Initial
`);
  const stdout=await new Promise<string>((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-File',script,'-Reader',fileURLToPath(new URL('./tenantDlpReader.ps1',import.meta.url)),'-Initial',initial],{windowsHide:true,stdio:'pipe'});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Synthetic protocol timed out'));},15000);
    let out='',err='';child.stdout.on('data',value=>{out+=value;});child.stderr.on('data',value=>{err+=value;});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(err));else resolve(out);});
    child.stdin.end([JSON.stringify({command:'refresh',requestId:next}),JSON.stringify({command:'refresh',requestId:initial,extra:'unsupported'}),JSON.stringify({command:'refresh',requestId:initial})].join('\n')+'\n');
  });
  const lines=stdout.trim().split(/\r?\n/).map(line=>{expect(line.startsWith('SWARM_DLP ')).toBe(true);return JSON.parse(line.slice(10));});
  expect(lines).toHaveLength(2);
  expect(lines.map(line=>line.requestId)).toEqual([initial,next]);
  expect(lines.map(line=>line.result.snapshot.policies[0].name)).toEqual(['read-1','read-2']);
});
it.runIf(process.platform==='win32')('executes the actual PowerShell pager against empty, paginated, failed and hostile responses',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-policy-pager-'));roots.push(root);
  const script=path.join(root,'pager-test.ps1');
  await fs.writeFile(script,String.raw`param([string]$Reader)
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Reader,[ref]$tokens,[ref]$errors)
if($errors.Count) { throw 'Reader syntax error' }
$definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-PolicyInventory'},$true)
. ([ScriptBlock]::Create($definition.Extent.Text))
$global:currentSession=@{tenantId='5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c'}
$caller='leon@graspai.co.uk'
function Test-ResponseBody {
 if(-not $ThrowOnFailure -or $Method -ne 'GET') { throw 'Unsafe invocation' }
 $script:requestCount++
 if($script:scenario -eq 'httpFailure') { throw 'HTTP 403' }
 if($script:scenario -eq 'malformed') { return [pscustomobject]@{Error=@{message='hidden API error'}} }
 if($script:scenario -eq 'hostile') { return [pscustomobject]@{value=@();nextLink='https://api.bap.microsoft.com.evil.test/providers/PowerPlatform.Governance/v1/policies'} }
 if($script:scenario -eq 'repeated') { return [pscustomobject]@{value=@();nextLink='https://api.bap.microsoft.com/providers/PowerPlatform.Governance/v1/policies?$top=50'} }
 if($script:scenario -eq 'alternate') { return [pscustomobject]@{value=@();'@odata.nextLink'='https://api.bap.microsoft.com/providers/PowerPlatform.Governance/v1/policies?page=2'} }
 if($script:scenario -eq 'paginated' -and $script:requestCount -eq 1) { return [pscustomobject]@{value=@(@{name='policy-1'});nextLink='https://api.bap.microsoft.com/providers/PowerPlatform.Governance/v1/policies?page=2'} }
 if($script:scenario -eq 'paginated') { return [pscustomobject]@{value=@(@{name='policy-2'})} }
 return [pscustomobject]@{value=@()}
}
function InvokeApiNoParseContent { param($Route,$Method,[switch]$ThrowOnFailure)
 if(-not $ThrowOnFailure -or $Method -ne 'GET') { throw 'Unsafe invocation' }
 $body=Test-ResponseBody
 return [pscustomobject]@{StatusCode=200;Content=($body | ConvertTo-Json -Depth 20 -Compress)}
}
$results=@()
foreach($scenario in @('empty','paginated','httpFailure','malformed','hostile','repeated','alternate')) {
 $script:scenario=$scenario; $script:requestCount=0
 try { $inventory=Read-PolicyInventory; $results+=@{scenario=$scenario;status='observed';pages=$inventory.pages;count=$inventory.policies.Count;requests=$script:requestCount} }
 catch { $results+=@{scenario=$scenario;status='unavailable';requests=$script:requestCount} }
}
ConvertTo-Json -InputObject @($results) -Compress
`);
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-File',script,'-Reader',fileURLToPath(new URL('./tenantDlpReader.ps1',import.meta.url))],{timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  const results=JSON.parse(stdout.trim());
  expect(results.slice(0,2)).toMatchObject([{scenario:'empty',status:'observed',pages:1,count:0,requests:1},{scenario:'paginated',status:'observed',pages:2,count:2,requests:2}]);
  for(const result of results.slice(2)) expect(result).toMatchObject({status:'unavailable',requests:1});
});
