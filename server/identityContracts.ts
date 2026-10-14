import {z} from 'zod';

export const platformIdentitySchema=z.strictObject({tenantId:z.uuid(),username:z.email(),environmentId:z.string().regex(/^(?:Default-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)});
export type PlatformIdentity=z.infer<typeof platformIdentitySchema>;
export type Command=(executable:string,args:string[])=>Promise<string>;
export function identityRoot(value:string){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('Platform identity requires an HTTPS organization root');
  return url.origin;
}
export function identityField(output:string,label:string){
  if(Buffer.byteLength(output)>64*1024)throw new Error('Platform identity profile exceeds its bound');
  const pattern=new RegExp(`^[ \\t]*${label}:[ \\t]*(.*)$`,'i');
  const rows=output.split(/\r?\n/).map(line=>pattern.exec(line)).filter(row=>row!==null);
  if(rows.length!==1||!rows[0]![1].trim())throw new Error('Platform identity profile is missing or ambiguous');
  return rows[0]![1].trim();
}
