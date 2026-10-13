import fs from 'node:fs/promises';
import path from 'node:path';
import {GEMINI_HOOK_SOURCE,geminiSettings} from '../server/geminiBridge.ts';
import {playwrightMcp} from '../server/browserTools.ts';

// Stages reviewable artifacts only. Administrator installation is a separate explicit operation.
const stage=path.resolve('.swarm-reliability/gemini-governance-install');
const target=path.join(process.env.ProgramFiles??'C:/Program Files','Agent Swarm','Gemini');
const hook=path.join(target,'gemini-hook.cjs');
const command=`"${process.execPath}" "${hook}"`;
const office={httpUrl:'${CUBEFARM_OFFICE_URL}'};
const browser=playwrightMcp('${CUBEFARM_BROWSER_OUTPUT}');
await fs.mkdir(stage,{recursive:true});
await fs.writeFile(path.join(stage,'gemini-hook.cjs'),GEMINI_HOOK_SOURCE);
await fs.writeFile(path.join(stage,'settings.json'),JSON.stringify(geminiSettings(command,{office}),null,2));
await fs.writeFile(path.join(stage,'browser-settings.json'),JSON.stringify(geminiSettings(command,{office,playwright:browser}),null,2));
await fs.writeFile(path.join(stage,'Install.ps1'),String.raw`
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this reviewed installer in an administrator PowerShell. Gemini requires administrator-owned system settings.'}
$programRoot=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$target=Join-Path $programRoot 'Agent Swarm\Gemini'
$resolved=[IO.Path]::GetFullPath($target)
$expected=[IO.Path]::GetFullPath((Join-Path $programRoot 'Agent Swarm\Gemini'))
if($resolved -ne $expected){throw 'Installation target does not match the protected Agent Swarm directory'}
if(Test-Path -LiteralPath $target){throw 'The protected directory already exists. Review its current configuration before replacing it.'}

$appRoot=Split-Path -Parent $target
$adminSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
if(-not(Test-Path -LiteralPath $appRoot)){
 New-Item -ItemType Directory -Path $appRoot | Out-Null
 $parentAcl=Get-Acl -LiteralPath $appRoot
 $parentAcl.SetOwner($adminSid)
 Set-Acl -LiteralPath $appRoot -AclObject $parentAcl
}
New-Item -ItemType Directory -Path $target | Out-Null
foreach($name in @('gemini-hook.cjs','settings.json','browser-settings.json')){
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $target $name)
}
$adminSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
foreach($item in @($target,(Join-Path $target 'gemini-hook.cjs'),(Join-Path $target 'settings.json'),(Join-Path $target 'browser-settings.json'))){
 $acl=Get-Acl -LiteralPath $item
 $acl.SetOwner($adminSid)
 Set-Acl -LiteralPath $item -AclObject $acl
}
Write-Output 'Protected Gemini bridge installed. Restart only the Agent Swarm server, then verify native readiness before sending a task. Authentication is unchanged.'
`);
process.stdout.write(JSON.stringify({stage,target,scope:'Prepared only; no machine configuration or ACL changes applied'})+'\n');
