import {afterEach,expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
const cli=vi.hoisted(()=>({gh:vi.fn(),ghJson:vi.fn()}));vi.mock('./exec.ts',()=>cli);
import {listPulls,prFiles,issueState,prDiff,uploadEvidence,EVIDENCE_BRANCH} from './github.ts';
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
it.each(['OPEN','CLOSED'])('returns only a scope-bound known issue state: %s',async state=>{cli.ghJson.mockResolvedValue({data:{repository:{nameWithOwner:repo,issue:{number:1,state}}}});expect(await issueState(repo,1)).toBe(state);});
it('reports missing only from an explicit nullable issue in the exact readable repository',async()=>{cli.ghJson.mockResolvedValue({data:{repository:{nameWithOwner:repo,issue:null}}});expect(await issueState(repo,1)).toBeNull();});
it.each(['auth','missing-repository','wrong-repository','wrong-issue','unknown-state','partial-errors','malformed'] as const)('refuses unverified issue status (%s) without echoing diagnostics',async mode=>{
 const raw:any={data:{repository:{nameWithOwner:repo,issue:{number:1,state:'CLOSED'}}}};
 if(mode==='auth')cli.ghJson.mockRejectedValue(new Error('private-auth-token'));else{if(mode==='missing-repository')raw.data.repository=null;if(mode==='wrong-repository')raw.data.repository.nameWithOwner='other/repo';if(mode==='wrong-issue')raw.data.repository.issue.number=2;if(mode==='unknown-state')raw.data.repository.issue.state='FUTURE';if(mode==='partial-errors')raw.errors=[{message:'private-auth-token'}];cli.ghJson.mockResolvedValue(mode==='malformed'?{}:raw);}
 await expect(issueState(repo,1)).rejects.toThrow('could not be verified');await expect(issueState(repo,1)).rejects.not.toThrow('private-auth-token');
});
it('preserves unavailable diff evidence rather than returning an empty diff',async()=>{cli.gh.mockRejectedValueOnce(new Error('private-auth-token'));await expect(prDiff(repo,1)).rejects.toThrow('diff is unavailable');cli.gh.mockResolvedValueOnce('');expect(await prDiff(repo,1)).toBe('');});
function referenceResponse(fullName:string,exists=true){return {data:{repository:{nameWithOwner:fullName,defaultBranchRef:{target:{oid:head}},ref:exists?{name:EVIDENCE_BRANCH,target:{oid:head}}:null}}};}
async function acknowledge(args:string[],options?:{input?:string}){
 if(args[3].endsWith('/git/refs'))return JSON.stringify({ref:`refs/heads/${EVIDENCE_BRANCH}`,object:{type:'commit',sha:head}});
 if(!args.includes('PUT'))return JSON.stringify({sha:head});
 const body=JSON.parse(options!.input!),bytes=Buffer.from(body.content,'base64');return JSON.stringify({content:{path:args[3].split('/contents/')[1],sha:crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}});
}
it.each(['auth','wrong-repository','missing-repository','partial-errors','missing-authority','wrong-reference'] as const)('never creates an evidence branch after unavailable inspection: %s',async mode=>{
 const fullName=`synthetic/ref-${mode}`,raw:any=referenceResponse(fullName,false);
 if(mode==='auth')cli.ghJson.mockRejectedValue(new Error('private-auth-token'));else{if(mode==='wrong-repository')raw.data.repository.nameWithOwner='other/repo';if(mode==='missing-repository')raw.data.repository=null;if(mode==='partial-errors')raw.errors=[{message:'private-auth-token'}];if(mode==='missing-authority')raw.data.repository.defaultBranchRef=null;if(mode==='wrong-reference')raw.data.repository.ref={name:'other-branch',target:{oid:head}};cli.ghJson.mockResolvedValue(raw);}
 await expect(uploadEvidence(fullName,'qa/result.png',Buffer.from('fixture'))).rejects.toThrow('no branch creation was attempted');expect(cli.gh).not.toHaveBeenCalled();
 cli.ghJson.mockResolvedValue(referenceResponse(fullName));cli.gh.mockImplementation(acknowledge);expect(await uploadEvidence(fullName,'qa/result.png',Buffer.from('fixture'))).toContain(EVIDENCE_BRANCH);expect(cli.gh.mock.calls.every(([args])=>args.includes('PUT'))).toBe(true);
});
it('creates an evidence branch only after confirmed absence and does not repeat successful provisioning',async()=>{
 const fullName='synthetic/confirmed-absence';cli.ghJson.mockResolvedValue(referenceResponse(fullName,false));cli.gh.mockImplementation(acknowledge);
 expect(await uploadEvidence(fullName,'qa/one.png',Buffer.from('fixture'))).toContain('/qa/one.png');expect(cli.gh.mock.calls.filter(([args])=>args.includes('POST'))).toHaveLength(3);expect(cli.gh.mock.calls.filter(([args])=>args.includes('PUT'))).toHaveLength(1);
 await uploadEvidence(fullName,'qa/two.png',Buffer.from('fixture'));expect(cli.ghJson).toHaveBeenCalledOnce();expect(cli.gh.mock.calls.filter(([args])=>args.includes('POST'))).toHaveLength(3);
});
it('shares concurrent evidence-branch provisioning and verifies each upload acknowledgement',async()=>{
 const fullName='synthetic/concurrent-evidence';let ready!:(value:unknown)=>void;cli.ghJson.mockImplementationOnce(()=>new Promise(resolve=>{ready=resolve;}));cli.gh.mockImplementation(acknowledge);
 const first=uploadEvidence(fullName,'qa/one.png',Buffer.from('one')),second=uploadEvidence(fullName.toUpperCase(),'qa/two.png',Buffer.from('two'));for(let i=0;i<10;i++)await Promise.resolve();expect(cli.ghJson).toHaveBeenCalledOnce();expect(cli.gh).not.toHaveBeenCalled();ready(referenceResponse(fullName,false));expect(await Promise.all([first,second])).toHaveLength(2);expect(cli.gh.mock.calls.filter(([args])=>args.includes('POST'))).toHaveLength(3);expect(cli.gh.mock.calls.filter(([args])=>args.includes('PUT'))).toHaveLength(2);
});
it('serializes same-repository uploads and snapshots bytes before waiting',async()=>{
 const fullName='synthetic/serialized-uploads';cli.ghJson.mockResolvedValue(referenceResponse(fullName));let release!:(value:string)=>void;let firstReceipt='';
 cli.gh.mockImplementationOnce(async(args,options)=>{firstReceipt=await acknowledge(args,options);return new Promise(resolve=>{release=resolve;});}).mockImplementation(acknowledge);
 const bytes=Buffer.from('original'),first=uploadEvidence(fullName,'qa/one.png',Buffer.from('first')),second=uploadEvidence(fullName,'qa/two.png',bytes);bytes.fill(0);
 for(let i=0;i<30&&!release;i++)await Promise.resolve();expect(cli.gh).toHaveBeenCalledOnce();release(firstReceipt);await Promise.all([first,second]);expect(cli.gh).toHaveBeenCalledTimes(2);const body=JSON.parse(cli.gh.mock.calls[1][1].input);expect(Buffer.from(body.content,'base64')).toEqual(Buffer.from('original'));
});
it('lets a queued upload proceed after a prior upload fails without repeating the failed mutation',async()=>{
 const fullName='synthetic/upload-repair';cli.ghJson.mockResolvedValue(referenceResponse(fullName));cli.gh.mockRejectedValueOnce(new Error('Synthetic upload unavailable')).mockImplementation(acknowledge);
 const failed=uploadEvidence(fullName,'qa/failed.png',Buffer.from('failed')).then(()=>null,error=>error),next=uploadEvidence(fullName,'qa/next.png',Buffer.from('next'));
 expect((await failed).message).toContain('did not acknowledge');expect(await next).toContain('/qa/next.png');expect(cli.gh).toHaveBeenCalledTimes(2);expect(cli.gh.mock.calls.filter(([args])=>args[3].endsWith('qa/failed.png'))).toHaveLength(1);expect(cli.ghJson).toHaveBeenCalledTimes(2);
});
it.each(['reference','commit','type'] as const)('does not cache an unverified branch-creation %s acknowledgement',async mode=>{
 const fullName=`synthetic/branch-receipt-${mode}`;cli.ghJson.mockResolvedValue(referenceResponse(fullName,false));cli.gh.mockImplementation(async(args,options)=>{
   const receipt=JSON.parse(await acknowledge(args,options));if(args[3].endsWith('/git/refs')){if(mode==='reference')receipt.ref='refs/heads/unapproved';if(mode==='commit')receipt.object.sha='b'.repeat(40);if(mode==='type')receipt.object.type='tag';}return JSON.stringify(receipt);
 });await expect(uploadEvidence(fullName,'qa/file.png',Buffer.from('fixture'))).rejects.toThrow();expect(cli.gh.mock.calls.some(([args])=>args.includes('PUT'))).toBe(false);
 cli.ghJson.mockResolvedValue(referenceResponse(fullName));cli.gh.mockImplementation(acknowledge);expect(await uploadEvidence(fullName,'qa/next.png',Buffer.from('fixture'))).toContain('qa/next.png');expect(cli.ghJson).toHaveBeenCalledTimes(2);
});
it.each(['path','sha','missing','ambiguous-json'] as const)('does not return a successful evidence URL for an unverified %s receipt',async mode=>{
 const fullName=`synthetic/bad-receipt-${mode}`;cli.ghJson.mockResolvedValue(referenceResponse(fullName));cli.gh.mockImplementation(async(args,options)=>{
   const receipt=JSON.parse(await acknowledge(args,options));if(mode==='path')receipt.content.path='other.png';if(mode==='sha')receipt.content.sha=head;if(mode==='missing')return '{}';const text=JSON.stringify(receipt);return mode==='ambiguous-json'?`{"content":null,${text.slice(1)}`:text;
 });await expect(uploadEvidence(fullName,'qa/file.png',Buffer.from('fixture'))).rejects.toThrow();expect(cli.gh).toHaveBeenCalledOnce();
});
it.each(['../other.png','/absolute.png','qa//file.png','qa/./file.png','qa/file.png?ref=main','qa/quote".png'])('refuses unsafe evidence path %s before repository inspection',async file=>{
 await expect(uploadEvidence('synthetic/unsafe-path',file,Buffer.from('fixture'))).rejects.toThrow('bounded ordinary relative path');expect(cli.ghJson).not.toHaveBeenCalled();expect(cli.gh).not.toHaveBeenCalled();
});
it('rejects unsafe scan identity before invoking GitHub',async()=>{for(const name of ['../outside/repo','../repo','synthetic/..'])await expect(prFiles(name,1,head)).rejects.toThrow();await expect(prFiles(repo,0,head)).rejects.toThrow();await expect(prFiles(repo,1,'branch-name')).rejects.toThrow();expect(cli.ghJson).not.toHaveBeenCalled();});
it('bounds accumulated selected-file bytes rather than accepting many individually permitted files',async()=>{
  const f=scanFixture(Buffer.from('x'.repeat(5_000_000))),original=cli.ghJson.getMockImplementation()!;cli.ghJson.mockImplementation(async(args:string[])=>args.includes('--slurp')?[Array.from({length:7},(_,index)=>({...f.entry,filename:`src/large${index}.ts`}))]:original(args));
  await expect(prFiles(repo,1,head)).rejects.toThrow('accumulated scan bound');
});
