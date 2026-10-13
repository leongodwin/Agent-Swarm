import crypto from 'node:crypto';
import {z} from 'zod';
import type {PolicyReader,StartPolicyReader} from './tenantDlp.ts';

interface Channel {
  connected?:boolean;
  send?(value:unknown,callback:(error?:Error|null)=>void):unknown;
  on(event:'message'|'disconnect',listener:(value?:unknown)=>void):unknown;
  off(event:'message'|'disconnect',listener:(value?:unknown)=>void):unknown;
}
const responseSchema=z.discriminatedUnion('event',[
  z.object({type:z.literal('office:policy'),ownerId:z.uuid(),requestId:z.uuid(),event:z.literal('ready'),pid:z.number().int().positive().optional()}).strict(),
  z.object({type:z.literal('office:policy'),ownerId:z.uuid(),requestId:z.uuid(),event:z.literal('result'),result:z.unknown()}).strict(),
  z.object({type:z.literal('office:policy'),ownerId:z.uuid(),requestId:z.uuid(),event:z.literal('ended')}).strict(),
]);

export function launcherPolicyReader(channel:Channel=process):StartPolicyReader {
  return (identity,result,ended,initialId)=>{
    if(!channel.connected||!channel.send)throw new Error('Policy launcher is unavailable');
    const ownerId=crypto.randomUUID();let stopped=false,currentId=initialId;
    const detach=()=>{if(stopped)return;stopped=true;channel.off('message',message);channel.off('disconnect',finish);};
    const release=(keepWarm:boolean)=>{if(channel.connected)try {channel.send!({type:'office:policy',action:'release',ownerId,keepWarm},()=>{});}catch {/* The launcher may already have disconnected. */}};
    const finish=()=>{if(stopped)return;detach();release(false);ended();};
    const send=(value:unknown)=>{if(!channel.connected){finish();return;}try {channel.send!(value,error=>{if(error)finish();});}catch {finish();}};
    const handle:PolicyReader={refresh(requestId){if(stopped)throw new Error('Policy reader is closed');currentId=requestId;send({type:'office:policy',action:'read',ownerId,requestId,identity});},stop(keepWarm=false){if(stopped)return;detach();release(keepWarm);}};
    const message=(value?:unknown)=>{
      const parsed=responseSchema.safeParse(value);if(!parsed.success)return;
      const response=parsed.data;if(response.ownerId!==ownerId||response.requestId!==currentId||stopped)return;
      if(response.event==='ready')handle.pid=response.pid;
      else if(response.event==='result')result(response.result,response.requestId);
      else finish();
    };
    channel.on('message',message);channel.on('disconnect',finish);
    handle.refresh(initialId);return handle;
  };
}
