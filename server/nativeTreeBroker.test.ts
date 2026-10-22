import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {expect,it,vi} from 'vitest';
import {bridgeNativeTree} from './nativeTreeBroker.mjs';
function fixture(){const control=new PassThrough(),stdin=new PassThrough(),host=Object.assign(new EventEmitter(),{stdin}),launch=vi.fn(()=>host as unknown as ChildProcess),finish=vi.fn();bridgeNativeTree(control,launch,finish);return {control,stdin,host,launch,finish};}
it('forwards a split JSON payload once and keeps the native control pipe alive until parent EOF',async()=>{
 const f=fixture(),output:string[]=[];f.stdin.on('data',chunk=>output.push(chunk.toString()));f.control.write('{"id":');expect(f.launch).not.toHaveBeenCalled();f.control.write('"owned"}\n');expect(f.launch).toHaveBeenCalledOnce();expect(output.join('')).toBe('{"id":"owned"}\n');f.control.write('ignored');expect(f.launch).toHaveBeenCalledOnce();f.control.end();await new Promise<void>(resolve=>f.stdin.once('finish',resolve));f.host.emit('close',7);expect(f.finish).toHaveBeenCalledWith(7);
});
it.each(['oversized','invalid-json'])('refuses %s payload without launching PowerShell',mode=>{const f=fixture();f.control.write(mode==='oversized'?'x'.repeat(1024*1024+1):'invalid\n');expect(f.launch).not.toHaveBeenCalled();expect(f.finish).toHaveBeenCalledWith(1);});
it.each(['host-error','host-signal','control-error'])('handles %s without inventing a native receipt',async mode=>{
 const f=fixture();f.control.write('{}\n');if(mode==='host-error'){f.host.emit('error',new Error('startup failure'));expect(f.finish).toHaveBeenCalledWith(1);}
 if(mode==='host-signal'){f.host.emit('close',null);expect(f.finish).toHaveBeenCalledWith(1);}
 if(mode==='control-error'){f.control.emit('error',new Error('parent lost'));expect(f.stdin.writableEnded).toBe(true);}
 f.stdin.emit('error',new Error('closed pipe'));
});
