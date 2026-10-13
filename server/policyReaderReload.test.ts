import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {PolicyReaderHost,nativePolicyReader} from './policyReaderHost.mjs';

it.runIf(process.platform==='win32')('reuses one actual PowerShell session across two actual server clients and performs a fresh read',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-policy-reload-'));
  const productionReader=fileURLToPath(new URL('./tenantDlpReader.ps1',import.meta.url));
  const wrapper=path.join(root,'synthetic-provider.ps1');
  const fixture=path.join(root,'office-client.mts');
  const readerLiteral=productionReader.replace(/'/g,"''");
  await fs.writeFile(wrapper,String.raw`param([Guid]$TenantId,[string]$ExpectedUser,[Guid]$RequestId)
$ErrorActionPreference='Stop'
# Real PowerShell process and reader protocol, synthetic module/provider only.
function Import-Module { param($Name,$RequiredVersion,[switch]$DisableNameChecking,$WarningAction) }
function Add-PowerAppsAccount { param($TenantID,$UseSystemBrowser)
 $global:authCalls++
 $global:currentSession=@{loggedIn=$true;tenantId=$TenantID;upn='leon@graspai.co.uk'}
}
$global:authCalls=0;$global:readCalls=0
function InvokeApiNoParseContent { param($Route,$Method,[switch]$ThrowOnFailure)
 if($Method -ne 'GET' -or -not $ThrowOnFailure) { throw 'Unexpected mutation' }
 $global:readCalls++
 $body=@{value=@(@{name=('read-'+$global:readCalls);authCalls=$global:authCalls;readerPid=$PID})}
 return [pscustomobject]@{StatusCode=200;Content=($body | ConvertTo-Json -Depth 5 -Compress)}
}
& '${readerLiteral}' -TenantId $TenantId -ExpectedUser $ExpectedUser -RequestId $RequestId
`);
  await fs.writeFile(fixture,`
import {TenantDlpService} from ${JSON.stringify(new URL('./tenantDlp.ts',import.meta.url).href)};
import {policyReaderMode} from ${JSON.stringify(new URL('./tenantDlp.ts',import.meta.url).href)};
if(policyReaderMode!=='launcher')throw new Error('Launcher mode was not selected');
const service=new TenantDlpService(process.argv[2]);
await service.init();
service.refresh({tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',caller:'leon@graspai.co.uk'});
const deadline=Date.now()+15000;
while(service.view().status==='reading'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
await service.settled();
if(service.view().status!=='observed')throw new Error('Fixture policy read failed: '+service.view().status);
const view=service.view(),snapshot=service.observation({tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',caller:'leon@graspai.co.uk'});
await service.close(process.argv[3]==='restart');
await new Promise<void>((resolve,reject)=>process.send!({type:'fixture:receipt',serverPid:process.pid,view,snapshot},error=>error?reject(error):resolve()));
process.disconnect();
`);
  const host=new PolicyReaderHost(wrapper,nativePolicyReader(wrapper));
  async function run(restart:boolean) {
    return new Promise<{serverPid:number;view:{readerPid:number};snapshot:{policies:Array<{name:string;authCalls:number;readerPid:number}>}}>((resolve,reject)=>{
      const child=spawn(process.execPath,['--import','tsx',fixture,path.join(root,'governance'),restart?'restart':'stop'],{cwd:process.cwd(),env:{...process.env,SWARM_POLICY_READER_HOST:'1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
      const timer=setTimeout(()=>{child.kill();reject(new Error('Fixture office timed out'));},20000);let receipt:unknown;let stderr='';
      child.stderr!.on('data',value=>{stderr+=value;});child.stdout!.on('data',()=>{});
      child.on('message',message=>{if((message as {type?:string})?.type==='fixture:receipt')receipt=message;else host.handle(child,message);});
      child.once('disconnect',()=>host.disconnect(child,restart));
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',code=>{clearTimeout(timer);if(code!==0||!receipt)reject(new Error('Fixture office failed: '+stderr));else resolve(receipt as Awaited<ReturnType<typeof run>>);});
    });
  }
  try {
    const first=await run(true),second=await run(false);
    expect(first.serverPid).not.toBe(second.serverPid);expect(first.view.readerPid).toBeGreaterThan(0);
    expect(first.view.readerPid).toBe(second.view.readerPid);
    expect(first.snapshot.policies).toEqual([{name:'read-1',authCalls:1,readerPid:first.view.readerPid}]);
    expect(second.snapshot.policies).toEqual([{name:'read-2',authCalls:1,readerPid:first.view.readerPid}]);
    expect(JSON.parse(await fs.readFile(path.join(root,'governance','tenant-dlp.json'),'utf8')).policies[0].name).toBe('read-2');
  } finally {host.clear();await fs.rm(root,{recursive:true,force:true});}
},45000);
