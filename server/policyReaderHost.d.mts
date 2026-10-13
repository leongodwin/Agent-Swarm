import type {StartPolicyReader} from './tenantDlp.ts';
export interface PolicyClient {connected?: boolean;send(value: unknown, callback?: (error?: Error|null)=>void): unknown;}
export function nativePolicyReader(readerPath:string):StartPolicyReader;
export class PolicyReaderHost {
  constructor(readerPath:string,start?:StartPolicyReader,idleMs?:number);
  handle(client:PolicyClient,input:unknown):boolean;
  disconnect(client:PolicyClient,keepWarm?:boolean):void;
  clear():void;
}
