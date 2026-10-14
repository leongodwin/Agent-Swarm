import {afterEach,expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
const cli=vi.hoisted(()=>({gh:vi.fn(),ghJson:vi.fn()}));vi.mock('./exec.ts',()=>cli);
import {listPulls,prFiles,issueState} from './github.ts';
afterEach(()=>vi.resetAllMocks());
const head='a'.repeat(40),repo='synthetic/repo';
const pull=(statusCheckRollup:unknown)=>({number:1,title:'Synthetic',url:'https://example.test/pr/1',headRefName:'swarm/test',headRefOid:head,state:'OPEN',isDraft:false,mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',reviewDecision:null,closingIssuesReferences:null,createdAt:'2026-10-14T00:00:00Z',mergedAt:null,additions:1,deletions:0,statusCheckRollup});
it.each(['SUCCESS','NEUTRAL','SKIPPED'])('recognizes completed %s checks without claiming full CI/integration compliance',async conclusion=>{
  cli.ghJson.mockResolvedValueOnce([pull([{name:'CI',status:'COMPLETED',conclusion}])]).mockResolvedValueOnce([]);expect((await listPulls(repo))[0]).toMatchObject({checks:'passing',pendingChecks:[],failedChecks:[]});
});
it.each(['FAILURE','ERROR','CANCELLED','TIMED_OUT','ACTION_REQUIRED','STARTUP_FAILURE','STALE'])('keeps %s checks failing and exposes the actual failed check',async conclusion=>{
  cli.ghJson.mockResolvedValueOnce([pull([{name:'CI',status:'COMPLETED',conclusion,detailsUrl:'https://example.test/failure'}])]).mockResolvedValueOnce([]);expect((await listPulls(repo))[0]).toMatchObject({checks:'failing',failedChecks:[{name:'CI',url:'https://example.test/failure'}]});
});
it.each([{status:'COMPLETED'},{status:'COMPLETED',conclusion:'FUTURE_UNKNOWN'},{conclusion:'SUCCESS'},{status:'IN_PROGRESS',conclusion:'SUCCESS'},{state:'EXPECTED'},{state:'PENDING'},{state:'FUTURE_UNKNOWN'},{}])('keeps incomplete or unknown check evidence pending: %#',async check=>{
  cli.ghJson.mockResolvedValueOnce([pull([{name:'CI',...check}])]).mockResolvedValueOnce([]);expect((await listPulls(repo))[0]).toMatchObject({checks:'pending',pendingChecks:['CI']});
});
it('handles commit statuses and absent rollups without inventing a successful check',async()=>{
  cli.ghJson.mockResolvedValueOnce([pull([{context:'deployment',state:'SUCCESS'}]),pull(null),pull([])]).mockResolvedValueOnce([]);expect((await listPulls(repo)).map(pr=>pr.checks)).toEqual(['passing','none','none']);
});
function scanFixture(bytes=Buffer.from('export const title="£ 東京";')){
  const sha=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),entry={filename:'src/app.ts',status:'modified',sha},body={type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64'),sha};let heads=0;
  cli.ghJson.mockImplementation(async(args:string[])=>args[0]==='pr'?{headRefOid:head,number:1,state:'OPEN',closingIssuesReferences:[],headRefName:'swarm/test',isCrossRepository:false}:args.includes('--slurp')?[[entry]]:body);
  return {entry,body,bytes,get heads(){return heads;},changedHead(){const original=cli.ghJson.getMockImplementation()!;cli.ghJson.mockImplementation(async(args:string[])=>args[0]==='pr'&&++heads>1?{headRefOid:'b'.repeat(40)}:original(args));}};
}
it('decodes exact pinned Unicode file bytes, accepting only API newline wrapping in base64',async()=>{
  const f=scanFixture();f.body.content=f.body.content.slice(0,12)+'\r\n'+f.body.content.slice(12)+'\n';expect(await prFiles(repo,1,head)).toEqual([{file:f.entry.filename,content:f.bytes.toString('utf8')}]);expect(cli.ghJson.mock.calls.filter(([args])=>args[0]==='pr')).toHaveLength(2);
});
it.each(['encoding','type','size','negative-size','fractional-size','invalid-base64','padding','blob-sha','listing-sha','invalid-utf8','changed-head','duplicate-path','unsafe-path','unknown-status'])('rejects %s instead of returning partial DLP scan input',async mode=>{
  const f=scanFixture(mode==='invalid-utf8'?Buffer.from([0xff]):undefined);
  if(mode==='encoding')f.body.encoding='none';if(mode==='type')f.body.type='symlink';if(mode==='size')f.body.size++;if(mode==='negative-size')f.body.size=-1;if(mode==='fractional-size')f.body.size=1.5;if(mode==='invalid-base64')f.body.content='!!!!';if(mode==='padding')f.body.content='AB==';if(mode==='blob-sha')f.body.sha='b'.repeat(40);if(mode==='listing-sha')f.entry.sha='b'.repeat(40);if(mode==='changed-head')f.changedHead();if(mode==='unsafe-path')f.entry.filename='../app.ts';if(mode==='unknown-status')f.entry.status='future';
  if(mode==='duplicate-path'){const original=cli.ghJson.getMockImplementation()!;cli.ghJson.mockImplementation(async(args:string[])=>args.includes('--slurp')?[[f.entry,f.entry]]:original(args));}
  await expect(prFiles(repo,1,head)).rejects.toThrow();
});
it('does not fetch removed or unrelated files and refuses listings at the GitHub truncation bound',async()=>{
  const f=scanFixture(),original=cli.ghJson.getMockImplementation()!;cli.ghJson.mockImplementation(async(args:string[])=>args.includes('--slurp')?[[{...f.entry,status:'removed'},{...f.entry,filename:'README.md'}]]:original(args));expect(await prFiles(repo,1,head)).toEqual([]);
  cli.ghJson.mockImplementation(async(args:string[])=>args.includes('--slurp')?Array.from({length:30},(_,page)=>Array.from({length:100},(_,index)=>({...f.entry,filename:`src/app${page}_${index}.ts`}))):original(args));await expect(prFiles(repo,1,head)).rejects.toThrow('API limit');
});
it.each(['OPEN','CLOSED','FUTURE_UNKNOWN'])('returns a known issue state or unknown for %s',async state=>{cli.ghJson.mockResolvedValue({state});expect(await issueState(repo,1)).toBe(state==='FUTURE_UNKNOWN'?null:state);});
it('rejects unsafe scan identity before invoking GitHub',async()=>{for(const name of ['../outside/repo','../repo','synthetic/..'])await expect(prFiles(name,1,head)).rejects.toThrow();await expect(prFiles(repo,0,head)).rejects.toThrow();await expect(prFiles(repo,1,'branch-name')).rejects.toThrow();expect(cli.ghJson).not.toHaveBeenCalled();});
it('bounds accumulated selected-file bytes rather than accepting many individually permitted files',async()=>{
  const f=scanFixture(Buffer.from('x'.repeat(5_000_000))),original=cli.ghJson.getMockImplementation()!;cli.ghJson.mockImplementation(async(args:string[])=>args.includes('--slurp')?[Array.from({length:7},(_,index)=>({...f.entry,filename:`src/large${index}.ts`}))]:original(args));
  await expect(prFiles(repo,1,head)).rejects.toThrow('accumulated scan bound');
});
