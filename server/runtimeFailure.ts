/** Only the native Copilot CLI rejection of the explicitly requested model.
 * Ordinary capacity/auth failures and quoted prose are not configuration holds. */
export function copilotUnavailableModel(text:string,model:string):boolean {
  if(!model)return false;
  const line=text.match(/(?:^|\n|\. )Error: Model "([^"\r\n]{1,500})" from --model flag is not available\.(?:$|\n)/);
  return line?.[1]===model;
}

/** Native OpenCode API failures only; messages and terminal prose never establish a rate limit. */
export function openCodeRateLimited(error:unknown):boolean {
  if(!error||typeof error!=='object'||Array.isArray(error))return false;
  const value=error as Record<string,unknown>,data=value.data;
  if(value.name!=='APIError'||!data||typeof data!=='object'||Array.isArray(data))return false;
  const fields=data as Record<string,unknown>;
  return fields.statusCode===429&&typeof fields.isRetryable==='boolean';
}
