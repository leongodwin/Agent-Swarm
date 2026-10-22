import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import {readDeliverySource,type DeliverySourceContext} from './deliverySourceRead.ts';
import {createEngineeringTools,createDeliveryQaTools} from './ceo.ts';
const request={kind:'repository-file',file:'src/app.ts'};
function fixture(content='first\nsecond\nthird'){const read=vi.fn(async()=>content),guard=vi.fn();const context:DeliverySourceContext={repoId:'synthetic/repo',sourceCommit:'a'.repeat(40),read,guard};return {read,guard,context};}
it.each(['../secret','/absolute','a/../b','a\\b','C:secret','a//b','./file','a\0b'])('refuses unsafe source path %j before reading',async file=>{const f=fixture();await expect(readDeliverySource({...request,file},f.context)).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();});
it.each([{kind:'office-document',document:'../../secret'},{...request,command:'whoami'},{...request,sourceCommit:'other'},{...request,maxLines:121},{...request,startLine:0}])('refuses unknown scope and pagination overrides %#',async input=>{const f=fixture();await expect(readDeliverySource(input,f.context)).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();});
it('returns exact bounded pages bound to the entire source hash and pinned commit',async()=>{
 const f=fixture(),first=await readDeliverySource({...request,maxLines:1},f.context);
 expect(first).toMatchObject({content:'first',startLine:1,endLine:1,totalLines:3,sourceCommit:f.context.sourceCommit,sha256:crypto.createHash('sha256').update('first\nsecond\nthird').digest('hex')});
 expect((await readDeliverySource({...request,startLine:2,maxLines:1,expectedSha256:first.sha256},f.context)).content).toBe('second');
 f.read.mockResolvedValue('changed');await expect(readDeliverySource({...request,expectedSha256:first.sha256},f.context)).rejects.toThrow('changed between pages');
});
it.each(['missing-pin','binary','full-size','page-size','outside'])('rejects %s source without publishing partial content',async mode=>{
 const f=fixture(mode==='binary'?'a\0b':mode==='full-size'?'x'.repeat(256*1024+1):mode==='page-size'?'x'.repeat(24*1024+1):'one');
 if(mode==='missing-pin')f.context.sourceCommit=null;
 await expect(readDeliverySource({...request,...(mode==='outside'?{startLine:2}:{})},f.context)).rejects.toThrow();if(mode==='missing-pin')expect(f.read).not.toHaveBeenCalled();
});
it('rechecks cancellation and scope drift after the asynchronous committed read',async()=>{
 const f=fixture();let closed=false;f.context.guard=()=>{if(closed)throw Error('session cancelled or scope changed');};f.read.mockImplementation(async()=>{closed=true;return 'unreleased';});
 await expect(readDeliverySource(request,f.context)).rejects.toThrow('session cancelled');
});
it('reads only enumerated office guidance without invoking repository access',async()=>{const f=fixture();f.context.sourceCommit=null;const value=await readDeliverySource({kind:'office-document',document:'DELIVERY',maxLines:2},f.context);expect(value.scope).toBe('approved-office-guidance');expect(value.sourceCommit).toBeNull();expect(value.content.length).toBeGreaterThan(0);expect(f.read).not.toHaveBeenCalled();});
it.each([['SHAREPOINT-SCHEMA-CONTRACT','sharepointProvisioning.ts'],['SCHEMA-BOOTSTRAP-CONTRACT','schemaBootstrap.ts'],['SHAREPOINT-TARGET-CONTRACT','sharepointWriteReadiness.ts']])('exposes only the named %s current implementation with bounded hash-pinned pages',async(document,file)=>{
 const f=fixture();f.context.sourceCommit=null;const original=await fs.readFile(new URL(file,import.meta.url),'utf8'),sha256=crypto.createHash('sha256').update(original).digest('hex');
 const page=await readDeliverySource({kind:'office-document',document,maxLines:2},f.context);expect(page).toMatchObject({scope:'approved-office-contract',document,sha256,sourceCommit:null,content:original.split('\n').slice(0,2).join('\n'),endLine:2});expect(f.read).not.toHaveBeenCalled();
 const next=await readDeliverySource({kind:'office-document',document,startLine:3,maxLines:1,expectedSha256:sha256},f.context);expect(next.content).toBe(original.split('\n')[2]);expect(next.limits).toContain('No authoring, tenant access or QA approval authority');
 await expect(readDeliverySource({kind:'office-document',document,expectedSha256:'0'.repeat(64)},f.context)).rejects.toThrow('changed between pages');
});
it.each(['sharepointProvisioning.ts','SHAREPOINT-SCHEMA-CONTRACT/../secret','../server/schemaBootstrap.ts','SHAREPOINT-SCHEMA-CONTRACT.json'])('rejects caller paths or aliases outside the named contract allowlist (%s)',async document=>{const f=fixture();await expect(readDeliverySource({kind:'office-document',document},f.context)).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();});
it.each(['engineering','qa'])('checks session authority and unambiguous JSON for %s source tool',async role=>{
 let denied:string|null='revoked';const read=vi.fn(async()=>({content:'approved'}));
 const tools=role==='engineering'?createEngineeringTools(()=>'',undefined,()=>denied,undefined,undefined,read):createDeliveryQaTools(()=>'',async()=>'',undefined,()=>denied,undefined,undefined,undefined,read);
 expect(JSON.parse(await tools.call('read_delivery_source',{request_json:JSON.stringify(request)})).isError).toBe(true);expect(read).not.toHaveBeenCalled();
 denied=null;await expect(tools.call('read_delivery_source',{request_json:'{"kind":"repository-file","file":"a","file":"b"}'})).rejects.toThrow();expect(read).not.toHaveBeenCalled();
 await tools.call('read_delivery_source',{request_json:JSON.stringify(request)});expect(read).toHaveBeenCalledExactlyOnceWith(request);
});
