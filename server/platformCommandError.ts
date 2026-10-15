/** Machine-readable provider codes are retained without copying response data
 * or access tokens into logs. A native exit alone never proves validation. */
export class PlatformCommandError extends Error {
  constructor(message:string,readonly platformErrorCode?:string){super(message);}
}
export function providerErrorCode(stdout:string):string|undefined{
  try{const value=JSON.parse(stdout);return typeof value?.error?.code==='string'&&/^0x[0-9a-f]{8}$/i.test(value.error.code)?value.error.code.toLowerCase():undefined;}catch{return undefined;}
}
