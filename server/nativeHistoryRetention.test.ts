import {it,expect,vi} from 'vitest';
import {collectSharepointChanges} from './sharepointProviderHistory.ts';
const list='11111111-1111-4111-8111-111111111111',token=(n:number)=>`1;3;${list};639279428815270000;${n}`;
const row={ChangeToken:{StringValue:token(2)},ChangeType:3,ItemId:17,ListId:list,Time:new Date(Date.now()-1000).toISOString(),NativeAdditionalField:'preserve-this'};
it('retains original provider fields and query cursors before requesting another page, including the terminal empty page',async()=>{
 const saved:any[]=[],raw={d:{results:[row]}},read=vi.fn().mockImplementationOnce(async()=>raw).mockImplementationOnce(async()=>{expect(saved).toHaveLength(1);return{d:{results:[]}};});
 const result=await collectSharepointChanges(list,token(1),token(3),read,async()=>{},async page=>{saved.push(structuredClone(page));});
 expect(saved[0]).toEqual({listId:list,page:0,startToken:token(1),endToken:token(3),providerPage:raw});expect(saved[1].startToken).toBe(token(2));expect(saved[1].providerPage).toEqual({d:{results:[]}});expect(result.completeWrites).toBe(false);expect(result.completeDispatches).toBe(false);
});
it('does not advance the query cursor when original-page retention fails',async()=>{
 const read=vi.fn(async()=>({d:{results:[row]}}));await expect(collectSharepointChanges(list,token(1),token(3),read,async()=>{},async()=>{throw Error('Disk unavailable');})).rejects.toThrow('Disk unavailable');expect(read).toHaveBeenCalledOnce();
});
it('rechecks ownership after page retention before a second query',async()=>{
 let revoked=false;const read=vi.fn(async()=>({d:{results:[row]}}));await expect(collectSharepointChanges(list,token(1),token(3),read,async()=>{if(revoked)throw Error('Owner lost');},async()=>{revoked=true;})).rejects.toThrow('Owner lost');expect(read).toHaveBeenCalledOnce();
});
