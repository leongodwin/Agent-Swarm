// Auth remains in the provider's existing secure caches. Do not move HOME or
// copy cache files: a new profile would create another interactive sign-in.
const allowed=new Set([
  'PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS',
  'HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','TEMP','TMP','TMPDIR','USERNAME','USER','LOGNAME','SHELL',
  'LANG','TERM','COLORTERM','NO_COLOR','FORCE_COLOR','CI','NODE_ENV','DOTNET_ROOT','DOTNET_ROOT_X64','DOTNET_ROOT_X86',
  'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE',
  'AZURE_CONFIG_DIR','POWER_PLATFORM_SKILLS_CONFIG_DIR','POWER_PLATFORM_SKILLS_TELEMETRY','POWER_PLATFORM_SKILLS_TELEMETRY_POWER_AUTOMATE_OPTOUT',
  'FLOWAGENT_HOME','FLOWAGENT_MSAL_CACHE_DIR','FLOWAGENT_TOKEN_CACHE_DIR','FLOWAGENT_DISABLE_MSAL_CACHE','FLOWAGENT_DISABLE_DISK_CACHE','FLOWAGENT_TENANT_ID','FLOWAGENT_TELEMETRY','FLOWAGENT_TELEMETRY_LOG',
  'PA_CLIENT_ID','PA_TENANT_ID','PA_LOGIN_HINT','PA_NO_ACCOUNT_PICKER','PA_CLOUD','PA_DEFAULT_ENVIRONMENT','PA_BASE_URL','PA_FLOW_RESOURCE','PA_GOVERNANCE_BASE','PA_PPAPI_BASE_URL','PA_PPAPI_RESOURCE','PA_PPAPI_SHARD_LENGTH','PA_PPAPI_SUFFIX',
]);
/** An environment allowlist, not an OS-account/filesystem sandbox or endpoint
 * authorization. Configured routing/network options retain existing semantics. */
export function flowAdapterEnvironment(parent:NodeJS.ProcessEnv=process.env,windows=process.platform==='win32'):Record<string,string>{
  const env:Record<string,string>={};
  for(const [name,value] of Object.entries(parent)){
    const key=windows?name.toUpperCase():name;
    if(value===undefined||value.startsWith('()')||!allowed.has(key)&&!/^LC_(?:ALL|CTYPE|NUMERIC|TIME|COLLATE|MONETARY|MESSAGES|PAPER|NAME|ADDRESS|TELEPHONE|MEASUREMENT|IDENTIFICATION)$/.test(key))continue;
    env[key]=value;
  }
  return env;
}
