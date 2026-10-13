import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { readBoundedJson } from './boundedJson.ts';

const schema=z.strictObject({version:z.literal(1),draining:z.boolean()});

/** Separate operational state: maintenance survives server and launcher restart.
 * Invalid/unreadable evidence blocks startup; only an absent file is a first run. */
export class OfficeMaintenance {
  private ready=false;
  private started=false;
  private closed=false;
  private tail:Promise<void>=Promise.resolve();
  private value=false;
  get draining(){return this.value;}
  constructor(private readonly file:string){}
  async init(){
    if(this.started||this.closed)throw new Error('Maintenance lifecycle already started or stopped');
    this.started=true;
    const raw=await readBoundedJson(this.file,4096);
    if(this.closed)throw new Error('Maintenance is closed');
    this.value=raw===undefined?false:schema.parse(raw).draining;
    this.ready=true;
  }
  change(draining:boolean,apply:()=>void):Promise<void>{
    if(!this.ready||this.closed)return Promise.reject(new Error('Maintenance is unavailable'));
    const work=this.tail.then(async()=>{
      if(this.closed)throw new Error('Maintenance is closed');
      const temporary=`${this.file}.${crypto.randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      try{
        const handle=await fs.open(temporary,'wx',0o600);
        try{await handle.writeFile(JSON.stringify(schema.parse({version:1,draining})));await handle.sync();}
        finally{await handle.close();}
        if(this.closed)throw new Error('Maintenance is closed');
        await fs.rename(temporary,this.file);
        this.value=draining;
        if(this.closed)throw new Error('Maintenance is closed');
        apply();
      }finally{await fs.rm(temporary,{force:true});}
    });
    this.tail=work.catch(()=>undefined);
    return work;
  }
  close(){this.closed=true;return this.tail;}
}
