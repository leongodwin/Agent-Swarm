import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TenantDlpService, verifyTenantSnapshot, type StartPolicyReader } from './tenantDlp.ts';

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
  const start=vi.fn<StartPolicyReader>((_identity,result)=>{report=result;return {refresh,stop};});
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
  const {service}=await fixture((_identity,result)=>{callbacks.push(result);const stop=vi.fn();stops.push(stop);return {refresh:vi.fn(),stop};});
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
  let report!:(value:unknown)=>void;const good=await fixture((_identity,result)=>{report=result;return {refresh:vi.fn(),stop:vi.fn()};});await fs.mkdir(path.join(good.root,'tenant-dlp.json'));
  good.service.refresh(identity);report({status:'observed',snapshot:snapshot()});await good.service.settled();expect(good.service.view().status).toBe('unavailable');expect(good.service.view().policyCount).toBeUndefined();
});
it('fails safely on start errors, process loss, expiry and late responses',async()=>{
  const broken=await fixture(()=>{throw new Error('secret startup detail');});expect(broken.service.refresh(identity).status).toBe('unavailable');
  vi.useFakeTimers();let ended!:()=>void;let report!:(value:unknown)=>void;const stop=vi.fn();
  const {service}=await fixture((_identity,result,end)=>{report=result;ended=end;return {refresh:vi.fn(),stop};});
  service.refresh(identity);ended();expect(service.view().status).toBe('unavailable');
  service.refresh(identity);await vi.advanceTimersByTimeAsync(600000);expect(service.view().status).toBe('unavailable');expect(stop).toHaveBeenCalled();
  report({status:'observed',snapshot:snapshot()});await service.settled();expect(service.view().status).toBe('unavailable');
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
