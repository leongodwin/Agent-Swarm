import type {Readable} from 'node:stream';
import type {ChildProcess} from 'node:child_process';
export function bridgeNativeTree(control:Readable,launch:()=>ChildProcess,finish:(code:number)=>void):void;
