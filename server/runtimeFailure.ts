/** Only the native Copilot CLI rejection of the explicitly requested model.
 * Ordinary capacity/auth failures and quoted prose are not configuration holds. */
export function copilotUnavailableModel(text:string,model:string):boolean {
  if(!model)return false;
  const line=text.match(/(?:^|\n|\. )Error: Model "([^"\r\n]{1,500})" from --model flag is not available\.(?:$|\n)/);
  return line?.[1]===model;
}
