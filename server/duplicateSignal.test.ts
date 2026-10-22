import {it,expect,vi} from 'vitest';
import {assertDuplicateSignal,observeDuplicateSignal,readDuplicateBaseline} from './duplicateSignal.ts';
function fixture(){
 const now=Date.now()-100,iso=(delta:number)=>new Date(now+delta).toISOString(),fields={Title:'Protected',RequestLabel:'CF-PROBE-DUPLICATE',RequestCorrelation:'same-run',ProbeStatus:'Processed' as const,AttemptCount:1,FlowRunId:'original',ReceiptCorrelation:'same-run',ErrorDetail:''},before={id:'42',version:'etag1',fields},after={...before,version:'etag3'},versions=[{id:'1.0',lastModifiedDateTime:iso(-300),fields},{id:'2.0',lastModifiedDateTime:iso(-150),fields:{...fields,ProbeStatus:'New'}},{id:'3.0',lastModifiedDateTime:iso(-100),fields}];let completed=false;
 const graph=vi.fn(async(method:string,url:string)=>{expect(method).toBe('GET');expect(url).toMatch(/^sites\/fixed\/lists\/fixed\/items\/42\/versions/);const rows=completed?versions:versions.slice(0,1),match=/\/versions\/([0-9.]+)\?/.exec(url);return structuredClone(match?rows.find(v=>v.id===match[1]):{value:rows.map(({fields:_fields,...meta})=>meta)});});
 const input={graph,list:'sites/fixed/lists/fixed/items',before,readCurrent:async()=>completed?after:before,guard:vi.fn(async()=>{}),now:()=>now};
 const baseline=()=>readDuplicateBaseline(input),observe=async()=>{const b=await baseline();completed=true;return observeDuplicateSignal({...input,baseline:b,scenarioStartedAt:iso(-200),after});};
 // Baseline observation precedes the scenario, independently of later reads.
 input.now=()=>completed?now:now-250;
 return{input,before,after,versions,graph,iso,now,observe,setCompleted:()=>{completed=true;}};
}
it('binds an exact New signal between stable distinct baseline/restored versions using GET only',async()=>{const f=fixture(),s=await f.observe();expect(s).toMatchObject({baseline:{version:'1.0'},version:'2.0',finalVersion:'3.0',fields:{ProbeStatus:'New',AttemptCount:1}});expect(s.providerVersionSha256).toMatch(/^[a-f0-9]{64}$/);expect(assertDuplicateSignal(s,f.before,f.after)).toEqual(s);});
it.each(['old-signal','wrong-count','wrong-receipt','wrong-correlation','wrong-run','wrong-label','wrong-title','wrong-diagnostic','no-new','two-new','future','wrong-version','final-before-signal','current-drift'] as const)('rejects %s version evidence',async mode=>{
 const f=fixture(),signal=f.versions[1];if(mode==='old-signal')signal.lastModifiedDateTime=f.iso(-220);if(mode==='wrong-count')signal.fields.AttemptCount=2;if(mode==='wrong-receipt')signal.fields.ReceiptCorrelation='foreign';if(mode==='wrong-correlation')signal.fields.RequestCorrelation='foreign';if(mode==='wrong-run')signal.fields.FlowRunId='other';if(mode==='wrong-label')signal.fields.RequestLabel='other';if(mode==='wrong-title')signal.fields.Title='other';if(mode==='wrong-diagnostic')signal.fields.ErrorDetail='other';if(mode==='no-new')signal.fields.ProbeStatus='Processed';if(mode==='two-new'){f.versions.push({...signal,id:'2.1'});}if(mode==='future')signal.lastModifiedDateTime=f.iso(1000);if(mode==='wrong-version')signal.id='unknown';if(mode==='final-before-signal')f.versions[2].id='1.1';if(mode==='current-drift')f.after.version='etag1';
 await expect(f.observe()).rejects.toThrow();
});
it.each(['missing','pagination','duplicate-id','oversize','cancelled','mutated-version'] as const)('rejects %s provider observations',async mode=>{
 const f=fixture(),original=f.graph.getMockImplementation()!;let expands=0;
 f.graph.mockImplementation(async(method,url)=>{if(mode==='cancelled')throw Error('Cancelled');const raw:any=await original(method,url);if(url.includes('versions?')){if(mode==='missing')return{value:[]};if(mode==='pagination')raw['@odata.nextLink']='next';if(mode==='duplicate-id')raw.value.push({...raw.value[0]});if(mode==='oversize')raw.extra='x'.repeat(256001);}if(mode==='mutated-version'&&url.includes('/versions/2.0?')&&++expands===2)raw.fields.Title='changed';return raw;});
 await expect(f.observe()).rejects.toThrow();
});
