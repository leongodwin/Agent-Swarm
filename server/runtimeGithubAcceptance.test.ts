import {afterEach,expect,it,vi} from 'vitest';
const cli=vi.hoisted(()=>({gh:vi.fn(),ghJson:vi.fn()}));
vi.mock('./exec.ts',()=>cli);
import {currentUser,listMyRepos,repoMeta,listIssues,listPulls,prForBranch,prDetails,issueDetails,issueState,prFiles,createIssue,editIssue,mergePull,updateBranch,closePull,commentPull,uploadEvidence} from './github.ts';
afterEach(()=>vi.resetAllMocks());
const repo='synthetic/runtime-qa',head='a'.repeat(40);
it('reads the authenticated login and sorts repository inventory with an optional exact owner',async()=>{
  cli.gh.mockResolvedValue('fixture-user');expect(await currentUser()).toBe('fixture-user');expect(cli.gh).toHaveBeenCalledExactlyOnceWith(['api','user','--jq','.login']);cli.ghJson.mockResolvedValue([{nameWithOwner:'synthetic/older',updatedAt:'2026-01-01'},{nameWithOwner:'synthetic/newer',updatedAt:'2026-02-01'}]);expect((await listMyRepos('synthetic')).map(item=>item.nameWithOwner)).toEqual(['synthetic/newer','synthetic/older']);expect(cli.ghJson.mock.calls.at(-1)![0]).toContain('synthetic');await listMyRepos();expect(cli.ghJson.mock.calls.at(-1)![0]).not.toContain('synthetic');
});
it.each([null,{name:''},{name:'develop'}])('defaults missing repository metadata safely while preserving an explicit default branch: %j',async branch=>{
  cli.ghJson.mockResolvedValue({nameWithOwner:repo,description:null,url:'https://example.invalid/repo',defaultBranchRef:branch});expect(await repoMeta(repo)).toMatchObject({description:'',defaultBranch:branch?.name||'main'});
});
it('normalizes nullable issue descriptions and labels and returns oldest issue numbers first',async()=>{
  cli.ghJson.mockResolvedValue([{number:8,title:'Second',body:null,url:'eight',labels:[{name:'bug'},{name:'swarm:dev'}],createdAt:'later'},{number:2,title:'First',body:'Defined',url:'two',labels:[],createdAt:'earlier'}]);expect(await listIssues(repo)).toMatchObject([{number:2,body:'Defined',labels:[]},{number:8,body:'',labels:['bug','swarm:dev']}]);
});
it('reports fallback check names, URLs and unknown merge state while preserving exact linked issues',async()=>{
  cli.ghJson.mockResolvedValueOnce([{number:1,title:'Synthetic',state:'OPEN',reviewDecision:'',closingIssuesReferences:[{number:7}],mergeStateStatus:'',statusCheckRollup:[{state:'FAILURE',targetUrl:'https://example.invalid/failure'},{context:'pending-deploy',state:'PENDING'}]}]).mockResolvedValueOnce([]);expect((await listPulls(repo))[0]).toMatchObject({reviewDecision:null,closesIssues:[7],checks:'failing',mergeState:'UNKNOWN',failedChecks:[{name:'check',url:'https://example.invalid/failure'}],pendingChecks:['pending-deploy']});
  cli.ghJson.mockResolvedValueOnce([{statusCheckRollup:[{name:'failed-no-url',conclusion:'FAILURE'}]}]).mockResolvedValueOnce([]);expect((await listPulls(repo))[0].failedChecks).toEqual([{name:'failed-no-url',url:null}]);
});
it('returns null only when an accessible branch has no PR and returns the matching PR otherwise',async()=>{
  cli.ghJson.mockResolvedValueOnce([]).mockResolvedValueOnce([{number:9,url:'https://example.invalid/pr/9'}]);expect(await prForBranch(repo,'swarm/work')).toBeNull();expect(await prForBranch(repo,'swarm/work')).toEqual({number:9,url:'https://example.invalid/pr/9'});
});
it('preserves null versus known merge receipts and issue content without inventing a merge state',async()=>{
  cli.ghJson.mockResolvedValueOnce({number:9,body:null,headRefOid:head,mergeCommit:null,closingIssuesReferences:null,mergeStateStatus:''});expect(await prDetails(repo,9)).toMatchObject({body:'',mergeCommitSha:null,closesIssues:[],mergeState:'UNKNOWN'});
  cli.ghJson.mockResolvedValueOnce({title:'Synthetic',body:null});expect(await issueDetails(repo,2)).toEqual({title:'Synthetic',body:''});cli.ghJson.mockResolvedValueOnce({title:'Synthetic',body:'actual body'});expect(await issueDetails(repo,2)).toEqual({title:'Synthetic',body:'actual body'});
});
it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1])('rejects unsupported issue identity before GitHub inspection: %s',async number=>{await expect(issueState(repo,number)).rejects.toThrow('could not be verified');expect(cli.ghJson).not.toHaveBeenCalled();});
it.each(['../repo','owner/..','owner/repo/extra','. /repo'])('rejects ambiguous repository scope before issue inspection: %s',async repository=>{await expect(issueState(repository,1)).rejects.toThrow('could not be verified');expect(cli.ghJson).not.toHaveBeenCalled();});
it.each([
  ['current user',()=>currentUser()],['repository inventory',()=>listMyRepos()],['repository metadata',()=>repoMeta(repo)],['issues',()=>listIssues(repo)],['pulls',()=>listPulls(repo)],['branch PR',()=>prForBranch(repo,'branch')],['PR details',()=>prDetails(repo,1)],['issue details',()=>issueDetails(repo,1)],
])('preserves unavailable %s rather than treating a command failure as an empty inventory',async(_name,read)=>{cli.gh.mockRejectedValue(new Error('Synthetic access unavailable'));cli.ghJson.mockRejectedValue(new Error('Synthetic access unavailable'));await expect((read as ()=>Promise<unknown>)()).rejects.toThrow('Synthetic access unavailable');});

it('does not fetch package content if the PR head changed before the scan began',async()=>{cli.ghJson.mockResolvedValue({headRefOid:'b'.repeat(40)});await expect(prFiles(repo,1,head)).rejects.toThrow('head changed');expect(cli.ghJson).toHaveBeenCalledOnce();});
it.each(['/src/app.ts','src\\app.ts','src//app.ts','src/./app.ts','src/../app.ts'])('rejects ambiguous file paths before file reads: %s',async filename=>{cli.ghJson.mockResolvedValueOnce({headRefOid:head}).mockResolvedValueOnce([[{filename,status:'modified',sha:head}]]);await expect(prFiles(repo,1,head)).rejects.toThrow('unsafe');expect(cli.ghJson).toHaveBeenCalledTimes(2);});

it('uses stdin for issue bodies and provisions each synthetic routing label only once',async()=>{
  const labels=['swarm:runtime-new-qa'];cli.gh.mockImplementation(async(args:string[])=>args[0]==='label'?'':'https://github.com/synthetic/runtime-qa/issues/42');expect(await createIssue(repo,'Synthetic issue','',labels)).toBe(42);expect(await createIssue(repo,'Synthetic issue','Body',labels)).toBe(42);expect(cli.gh.mock.calls.filter(([args])=>args[0]==='label')).toHaveLength(1);expect(cli.gh.mock.calls.filter(([args])=>args[0]==='issue').map(([,opts])=>opts.input)).toEqual([' ','Body']);
});
it('rejects an unacknowledged issue creation without repeating the mutation',async()=>{cli.gh.mockResolvedValue('unrecognized acknowledgement');await expect(createIssue(repo,'Synthetic','Body')).rejects.toThrow('new issue number');expect(cli.gh).toHaveBeenCalledOnce();});
it('does not issue an empty edit and preserves explicit empty-body and label edit semantics',async()=>{
  await editIssue(repo,1,{});expect(cli.gh).not.toHaveBeenCalled();cli.gh.mockResolvedValue('');await editIssue(repo,1,{body:'',addLabels:['swarm:runtime-edit-qa'],removeLabels:['obsolete']});expect(cli.gh.mock.calls.at(-1)).toEqual([['issue','edit','1','-R',repo,'--body-file','-','--add-label','swarm:runtime-edit-qa','--remove-label','obsolete'],{input:' '}]);
  await editIssue(repo,1,{removeLabels:['obsolete']});expect(cli.gh.mock.calls.at(-1)![1]).toBeUndefined();
});
it('pins a merge to reviewed head and only deletes local swarm branches after a successful merge acknowledgement',async()=>{
  cli.ghJson.mockResolvedValue({headRefName:'swarm/synthetic-runtime',isCrossRepository:false});cli.gh.mockResolvedValue('');await mergePull(repo,1,'squash',head);expect(cli.gh.mock.calls[0]).toEqual([['pr','merge','1','-R',repo,'--squash','--match-head-commit',head],{timeoutMs:60000}]);expect(cli.gh.mock.calls[1][0]).toEqual(['api','-X','DELETE',`repos/${repo}/git/refs/heads/swarm/synthetic-runtime`]);
});
it.each([{headRefName:'feature/synthetic',isCrossRepository:false},{headRefName:'swarm/synthetic',isCrossRepository:true}])('preserves branches outside local swarm ownership: %j',async branch=>{cli.ghJson.mockResolvedValue(branch);cli.gh.mockResolvedValue('');await mergePull(repo,2,'merge');expect(cli.gh).toHaveBeenCalledExactlyOnceWith(['pr','merge','2','-R',repo,'--merge'],{timeoutMs:60000});});
it('does not delete a branch after merge failure and tolerates only cleanup failure after successful merge',async()=>{
  cli.ghJson.mockResolvedValue({headRefName:'swarm/synthetic-runtime',isCrossRepository:false});cli.gh.mockRejectedValueOnce(new Error('Synthetic merge rejected'));await expect(mergePull(repo,1,'rebase')).rejects.toThrow('merge rejected');expect(cli.gh).toHaveBeenCalledOnce();cli.gh.mockReset().mockResolvedValueOnce('').mockRejectedValueOnce(new Error('Synthetic cleanup denied'));await expect(mergePull(repo,1,'rebase')).resolves.toBeUndefined();expect(cli.gh).toHaveBeenCalledTimes(2);
});
it('uses bounded branch updates, scoped closes and stdin comments without interpreting shell content',async()=>{
  cli.gh.mockResolvedValueOnce('').mockResolvedValueOnce('').mockResolvedValueOnce('created https://github.com/synthetic/runtime-qa/pull/1#issuecomment-42').mockResolvedValueOnce('no URL');await updateBranch(repo,1);await closePull(repo,1);expect(await commentPull(repo,1,'literal `code` and $value\nnext')).toBe('https://github.com/synthetic/runtime-qa/pull/1#issuecomment-42');expect(await commentPull(repo,1,'second')).toBe('');expect(cli.gh.mock.calls[0][1]).toEqual({timeoutMs:60000});expect(cli.gh.mock.calls[2][1]).toEqual({input:'literal `code` and $value\nnext'});
});
it.each([Buffer.alloc(0),Buffer.alloc(10*1024*1024+1),'not bytes'])('refuses missing, oversized or non-byte evidence before repository access',async bytes=>{await expect(uploadEvidence(repo,'qa/synthetic.png',bytes as Buffer)).rejects.toThrow('nonempty bytes');expect(cli.ghJson).not.toHaveBeenCalled();expect(cli.gh).not.toHaveBeenCalled();});
