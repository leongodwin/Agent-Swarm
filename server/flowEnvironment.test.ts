import {expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {flowAdapterEnvironment} from './flowEnvironment.ts';
it('preserves provider profile/cache and explicit routing settings without unrelated credentials or runtime injection',()=>{
  const env=flowAdapterEnvironment({PATH:'runtime-path',HOME:'existing-profile',USERPROFILE:'existing-profile',APPDATA:'existing-appdata',LOCALAPPDATA:'existing-local',AZURE_CONFIG_DIR:'existing-azure',FLOWAGENT_MSAL_CACHE_DIR:'existing-msal',FLOWAGENT_TOKEN_CACHE_DIR:'existing-token-cache',PA_LOGIN_HINT:'synthetic@example.test',PA_TENANT_ID:'synthetic-tenant',PA_DEFAULT_ENVIRONMENT:'approved-target',PA_CLOUD:'Public',HTTPS_PROXY:'explicit-proxy',NODE_EXTRA_CA_CERTS:'explicit-ca',OPENAI_API_KEY:'private',GEMINI_API_KEY:'private',ANTHROPIC_API_KEY:'private',GH_TOKEN:'private',AZURE_CLIENT_SECRET:'private',AWS_SECRET_ACCESS_KEY:'private',NODE_OPTIONS:'--require private-preload',SWARM_HOME:'office-state',SWARM_FLOWAGENT_ENTRY:'launcher-entry',UNKNOWN_CONFIGURATION:'private'},false);
  expect(env).toEqual({PATH:'runtime-path',HOME:'existing-profile',USERPROFILE:'existing-profile',APPDATA:'existing-appdata',LOCALAPPDATA:'existing-local',AZURE_CONFIG_DIR:'existing-azure',FLOWAGENT_MSAL_CACHE_DIR:'existing-msal',FLOWAGENT_TOKEN_CACHE_DIR:'existing-token-cache',PA_LOGIN_HINT:'synthetic@example.test',PA_TENANT_ID:'synthetic-tenant',PA_DEFAULT_ENVIRONMENT:'approved-target',PA_CLOUD:'Public',HTTPS_PROXY:'explicit-proxy',NODE_EXTRA_CA_CERTS:'explicit-ca'});
});
it('handles Windows case variants without promoting mis-cased POSIX configuration or shell functions',()=>{
  expect(flowAdapterEnvironment({Path:'runtime',pa_tenant_id:'tenant',node_options:'injection',gh_token:'private',LANG:'() { private; }',LC_TIME:'en_GB.UTF-8',HOME:undefined},true)).toEqual({PATH:'runtime',PA_TENANT_ID:'tenant',LC_TIME:'en_GB.UTF-8'});
  expect(flowAdapterEnvironment({pa_tenant_id:'wrong-case',Path:'wrong-case',LC_TIME:'en_GB.UTF-8'},false)).toEqual({LC_TIME:'en_GB.UTF-8'});
});
it('excludes a synthetic parent credential in an owned native child while preserving profile references',async()=>{
  const env=flowAdapterEnvironment({...process.env,GH_TOKEN:'synthetic-private-canary',PA_TENANT_ID:'synthetic-tenant',FLOWAGENT_MSAL_CACHE_DIR:'synthetic-existing-cache'});
  const child=spawn(process.execPath,['-e','process.stdout.write(JSON.stringify({credentialPresent:process.env.GH_TOKEN!==undefined,tenant:process.env.PA_TENANT_ID,cache:process.env.FLOWAGENT_MSAL_CACHE_DIR}));'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',data=>{stdout+=data.toString();});
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});expect(code).toBe(0);expect(JSON.parse(stdout)).toEqual({credentialPresent:false,tenant:'synthetic-tenant',cache:'synthetic-existing-cache'});
});
