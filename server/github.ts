import { gh, ghJson } from './exec.ts';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../shared/types.ts';
import { dlpResource } from '../shared/dlp.ts';
import {z} from 'zod';
import crypto from 'node:crypto';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {SerialWriter} from './atomicFile.ts';
function repositoryVariables(fullName:string){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)||fullName.split('/').some(part=>part==='.'||part==='..'))throw new Error('An exact GitHub repository is required');
  const [owner,name]=fullName.split('/');return ['-f',`owner=${owner}`,'-f',`name=${name}`];
}

// All GitHub access goes through the gh CLI so it reuses the user's existing `gh auth login`.

/** Inspect full files at a pinned head, rejecting a concurrently changed PR. */
export async function prFiles(fullName: string, number: number, headSha: string): Promise<{ file: string; content: string }[]> {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)||fullName.split('/').some(part=>part==='.'||part==='..')||!Number.isSafeInteger(number)||number<1||! /^[a-f0-9]{40}$/i.test(headSha))throw new Error('PR scan requires an exact repository, PR number and supported commit SHA');
  headSha=headSha.toLowerCase();
  if ((await prDetails(fullName, number)).headSha !== headSha) throw new Error('PR head changed during DLP scan');
  const pages = await ghJson<{ filename: string; status: string }[][]>(['api', '--paginate', '--slurp', `repos/${fullName}/pulls/${number}/files?per_page=100`]);
  const changed=z.array(z.array(z.object({filename:z.string().min(1).max(1000),status:z.enum(['added','removed','modified','renamed','copied','changed','unchanged']),sha:z.string().regex(/^[a-f0-9]{40}$/i)})).max(100)).max(30).parse(pages).flat();
  if(new Set(changed.map(file=>file.filename)).size!==changed.length||changed.some(file=>file.filename.startsWith('/')||file.filename.includes('\\')||file.filename.split('/').some(part=>!part||part==='.'||part==='..')))throw new Error('PR file paths are ambiguous or unsafe');
  if (changed.length >= 3000) throw new Error('PR file listing reached the API limit; full DLP coverage cannot be verified');
  const files = changed.filter((file) => file.status !== 'removed' && dlpResource(file.filename));
  const result: { file: string; content: string }[] = [];
  let totalBytes=0;
  // Bound concurrency and memory; an unavailable/oversized file blocks rather than skips the scan.
  for (const file of files) {
    const filename = file.filename.split('/').map(encodeURIComponent).join('/');
    const raw = await ghJson<{ type: string; encoding: string; size: number; content: string }>([
      'api', `repos/${fullName}/contents/${filename}?ref=${encodeURIComponent(headSha)}`,
    ]);
    const metadata=z.object({type:z.literal('file'),encoding:z.literal('base64'),size:z.number().int().min(0).max(5_000_000),content:z.string().max(7_000_000),sha:z.string().regex(/^[a-f0-9]{40}$/i)}).parse(raw);
    const encoded=metadata.content.replace(/[\r\n]/g,'');
    if(encoded.length%4||! /^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('PR file encoding is malformed');
    const bytes=Buffer.from(encoded,'base64');totalBytes+=bytes.length;
    if(bytes.length!==metadata.size||bytes.toString('base64')!==encoded||totalBytes>32*1024*1024)throw new Error('PR file size or accumulated scan bound differs');
    const blobSha=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(blobSha!==metadata.sha.toLowerCase()||blobSha!==file.sha.toLowerCase())throw new Error('PR file blob identity differs from its pinned listing');
    result.push({ file: file.filename, content: new TextDecoder('utf-8',{fatal:true}).decode(bytes) });
  }
  if ((await prDetails(fullName, number)).headSha !== headSha) throw new Error('PR head changed during DLP scan');
  return result;
}

export async function currentUser(): Promise<string> {
  return gh(['api', 'user', '--jq', '.login']);
}

export async function listMyRepos(owner?: string): Promise<GhRepoSummary[]> {
  const args = ['repo', 'list'];
  if (owner) args.push(owner);
  args.push('--limit', '200', '--json', 'nameWithOwner,description,visibility,updatedAt');
  const repos = await ghJson<GhRepoSummary[]>(args);
  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface RepoMeta {
  nameWithOwner: string;
  description: string;
  url: string;
  defaultBranch: string;
}

export async function repoMeta(fullName: string): Promise<RepoMeta> {
  const raw = await ghJson<{ nameWithOwner: string; description: string | null; url: string; defaultBranchRef: { name: string } | null }>([
    'repo',
    'view',
    fullName,
    '--json',
    'nameWithOwner,description,url,defaultBranchRef',
  ]);
  return {
    nameWithOwner: raw.nameWithOwner,
    description: raw.description ?? '',
    url: raw.url,
    defaultBranch: raw.defaultBranchRef?.name || 'main',
  };
}

export async function listIssues(fullName: string): Promise<IssueInfo[]> {
  const raw = await ghJson<
    { number: number; title: string; body: string; url: string; labels: { name: string }[]; createdAt: string }[]
  >(['issue', 'list', '-R', fullName, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,labels,createdAt']);
  return raw
    .map((i) => ({ number: i.number, title: i.title, body: i.body ?? '', url: i.url, labels: i.labels.map((l) => l.name), createdAt: i.createdAt }))
    .sort((a, b) => a.number - b.number);
}

interface RawPull {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  closingIssuesReferences: { number: number }[] | null;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  headRefOid: string;
  mergeStateStatus: string;
  // check runs (GitHub Actions…) carry name/status/conclusion/detailsUrl; commit statuses (Vercel…) carry context/state/targetUrl
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }[] | null;
}

const PR_FIELDS =
  'number,title,url,headRefName,headRefOid,state,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,createdAt,mergedAt,additions,deletions,statusCheckRollup';

type Check = NonNullable<RawPull['statusCheckRollup']>[number];
const BAD = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE','STALE'];
const failed = (c: Check) => BAD.includes(c.conclusion ?? '') || BAD.includes(c.state ?? '');
const pending = (c: Check) => !failed(c)&&!(c.status==='COMPLETED'&&['SUCCESS','NEUTRAL','SKIPPED'].includes(c.conclusion??'')&&!c.state||!c.status&&!c.conclusion&&c.state==='SUCCESS');
const checkName = (c: Check) => c.name || c.context || 'check';

function checksOf(rollup: RawPull['statusCheckRollup']): PullInfo['checks'] {
  if (!rollup || rollup.length === 0) return 'none';
  if (rollup.some(failed)) return 'failing';
  if (rollup.some(pending)) return 'pending';
  return 'passing';
}

function toPull(p: RawPull): PullInfo {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    headRefName: p.headRefName,
    state: p.state,
    isDraft: p.isDraft,
    mergeable: p.mergeable,
    reviewDecision: p.reviewDecision || null,
    closesIssues: (p.closingIssuesReferences ?? []).map((r) => r.number),
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    additions: p.additions,
    deletions: p.deletions,
    checks: checksOf(p.statusCheckRollup),
    headSha: p.headRefOid,
    mergeState: p.mergeStateStatus || 'UNKNOWN',
    failedChecks: (p.statusCheckRollup ?? []).filter(failed).map((c) => ({ name: checkName(c), url: c.detailsUrl || c.targetUrl || null })),
    pendingChecks: (p.statusCheckRollup ?? []).filter(pending).map(checkName),
  };
}

export async function listPulls(fullName: string): Promise<PullInfo[]> {
  const [open, merged] = await Promise.all([
    ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'open', '--limit', '50', '--json', PR_FIELDS]),
    ghJson<RawPull[]>(['pr', 'list', '-R', fullName, '--state', 'merged', '--limit', '8', '--json', PR_FIELDS]),
  ]);
  return [...open, ...merged].map(toPull);
}

// swarm:<specialty> labels route issues to specialists. gh refuses unknown labels, so they're created on first use.
const labelsMade = new Set<string>();

async function ensureLabel(fullName: string, name: string) {
  const key = `${fullName}#${name}`;
  if (labelsMade.has(key)) return;
  await gh(['label', 'create', name, '-R', fullName, '--color', 'c77dff', '--description', 'cubefarm: routed to this specialty', '--force']);
  labelsMade.add(key);
}

export async function createIssue(fullName: string, title: string, body: string, labels: string[] = []): Promise<number> {
  for (const l of labels) await ensureLabel(fullName, l);
  const args = ['issue', 'create', '-R', fullName, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const out = await gh(args, { input: body || ' ' });
  const match = out.match(/\/issues\/(\d+)/);
  if (!match) throw new Error(`Could not read the new issue number from gh output: ${out}`);
  return Number(match[1]);
}

/** OPEN or CLOSED; null when the repo has no such issue. */
export async function issueState(fullName: string, number: number): Promise<'OPEN' | 'CLOSED' | null> {
  try {
    if(!Number.isSafeInteger(number)||number<1)throw new Error('Invalid issue identity');
    const query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner issue(number:$number){number state}}}';
    const raw=await ghJson<unknown>(['api','graphql',...repositoryVariables(fullName),'-F',`number=${number}`,'-f',`query=${query}`]);
    const repository=z.object({data:z.object({repository:z.object({nameWithOwner:z.string(),issue:z.object({number:z.number().int().positive(),state:z.enum(['OPEN','CLOSED'])}).nullable()})}),errors:z.never().optional()}).parse(raw).data.repository;
    if(repository.nameWithOwner.toLowerCase()!==fullName.toLowerCase()||repository.issue&&repository.issue.number!==number)throw new Error('Issue scope differs');
    return repository.issue?.state??null;
  } catch {
    throw new Error('GitHub issue status could not be verified; restore repository access before retrying');
  }
}

/** Replace an issue's body and/or add and remove labels. */
export async function editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void> {
  const args = ['issue', 'edit', String(number), '-R', fullName];
  if (edit.body !== undefined) args.push('--body-file', '-');
  for (const l of edit.addLabels ?? []) {
    await ensureLabel(fullName, l);
    args.push('--add-label', l);
  }
  for (const l of edit.removeLabels ?? []) args.push('--remove-label', l);
  if (args.length === 5) return;
  await gh(args, edit.body !== undefined ? { input: edit.body || ' ' } : undefined);
}

/** Merge a PR. With headSha, GitHub refuses if anything was pushed after that commit (e.g. after QA signed it off). */
export async function mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void> {
  const pr = await ghJson<{ headRefName: string; isCrossRepository: boolean }>(['pr', 'view', String(number), '-R', fullName, '--json', 'headRefName,isCrossRepository']);
  await gh(['pr', 'merge', String(number), '-R', fullName, `--${method}`, ...(headSha ? ['--match-head-commit', headSha] : [])], { timeoutMs: 60_000 });
  // Tidy up the swarm branch on the remote; the local worktree is cleaned when the agent takes its next issue.
  if (!pr.isCrossRepository && pr.headRefName.startsWith('swarm/')) {
    await gh(['api', '-X', 'DELETE', `repos/${fullName}/git/refs/heads/${pr.headRefName}`]).catch(() => undefined);
  }
}

/** Merge the base branch into a PR's branch on GitHub, for repos that only merge up-to-date branches. */
export async function updateBranch(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'update-branch', String(number), '-R', fullName], { timeoutMs: 60_000 });
}

export async function closePull(fullName: string, number: number): Promise<void> {
  await gh(['pr', 'close', String(number), '-R', fullName]);
}

export async function prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null> {
  const list = await ghJson<{ number: number; url: string }[]>(['pr', 'list', '-R', fullName, '--head', branch, '--state', 'all', '--json', 'number,url', '--limit', '1']);
  return list[0] ?? null;
}

// ---------- QA support ----------

export interface PrDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  headRefName: string;
  headSha: string;
  isCrossRepository: boolean;
  closesIssues: number[];
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergeable: string;
  mergeState: string;
}

export async function prDetails(fullName: string, number: number): Promise<PrDetails> {
  const raw = await ghJson<{
    number: number;
    title: string;
    body: string;
    url: string;
    headRefName: string;
    headRefOid: string;
    isCrossRepository: boolean;
    closingIssuesReferences: { number: number }[] | null;
    state: PrDetails['state'];
    mergeable: string;
    mergeStateStatus: string;
  }>(['pr', 'view', String(number), '-R', fullName, '--json', 'number,title,body,url,headRefName,headRefOid,isCrossRepository,closingIssuesReferences,state,mergeable,mergeStateStatus']);
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    url: raw.url,
    headRefName: raw.headRefName,
    headSha: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    closesIssues: (raw.closingIssuesReferences ?? []).map((r) => r.number),
    state: raw.state,
    mergeable: raw.mergeable,
    mergeState: raw.mergeStateStatus || 'UNKNOWN',
  };
}

export async function prDiff(fullName: string, number: number): Promise<string> {
  try{return await gh(['pr', 'diff', String(number), '-R', fullName]);}
  catch{throw new Error('GitHub PR diff is unavailable; restore repository access before QA');}
}

export async function issueDetails(fullName: string, number: number): Promise<{ title: string; body: string }> {
  const raw = await ghJson<{ title: string; body: string }>(['issue', 'view', String(number), '-R', fullName, '--json', 'title,body']);
  return { title: raw.title, body: raw.body ?? '' };
}

export async function commentPull(fullName: string, number: number, body: string): Promise<string> {
  const out = await gh(['pr', 'comment', String(number), '-R', fullName, '--body-file', '-'], { input: body });
  return out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? '';
}

// QA screenshots live on an orphan branch so evidence never lands in the default branch when a PR is merged.
export const EVIDENCE_BRANCH = 'swarm-qa-evidence';
const evidenceReady = new Set<string>();
const evidencePending=new Map<string,Promise<void>>();
const evidenceUploads=new Map<string,{writer:SerialWriter;pending:number}>();

const ghApiJson = <T>(method: string, endpoint: string, body: unknown) =>
  gh(['api', '-X', method, endpoint, '-H', 'Content-Type: application/json', '--input', '-'], { input: JSON.stringify(body), timeoutMs: 120_000 }).then(
    (out) => (out ? parseUnambiguousJson(out) : null) as T,
  ).catch(()=>{throw new Error('GitHub evidence API did not acknowledge this operation; inspect the remote outcome before retrying');});

function ensureEvidenceBranch(fullName:string):Promise<void>{
  const key=fullName.toLowerCase();if(evidenceReady.has(key))return Promise.resolve();
  const prior=evidencePending.get(key);if(prior)return prior;
  const pending=Promise.resolve().then(()=>provisionEvidenceBranch(fullName)).then(()=>{evidenceReady.add(key);}).finally(()=>{if(evidencePending.get(key)===pending)evidencePending.delete(key);});evidencePending.set(key,pending);return pending;
}
async function provisionEvidenceBranch(fullName: string) {
  const query=`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){nameWithOwner defaultBranchRef{target{oid}} ref(qualifiedName:"refs/heads/${EVIDENCE_BRANCH}"){name target{oid}}}}`;
  const sha=z.string().regex(/^[a-f0-9]{40}$/i),reference=z.object({target:z.object({oid:sha})});
  let exists:boolean;
  try{
    const raw=await ghJson<unknown>(['api','graphql',...repositoryVariables(fullName),'-f',`query=${query}`]);
    const repository=z.object({data:z.object({repository:z.object({nameWithOwner:z.string(),defaultBranchRef:reference.nullable(),ref:reference.extend({name:z.literal(EVIDENCE_BRANCH)}).nullable()})}),errors:z.never().optional()}).parse(raw).data.repository;
    if(repository.nameWithOwner.toLowerCase()!==fullName.toLowerCase()||!repository.ref&&!repository.defaultBranchRef)throw new Error('Reference scope is unavailable');
    exists=repository.ref!==null;
  }catch{throw new Error('GitHub evidence branch could not be inspected; no branch creation was attempted');}
  if(!exists){
    const readme =
      '# QA evidence\n\nScreenshots attached to pull request QA reports by cubefarm QA agents.\nThis branch has no shared history with the code and is never merged.\n';
    const newTree = z.object({sha}).parse(await ghApiJson<unknown>('POST', `repos/${fullName}/git/trees`, {
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: readme }],
    }));
    const commit = z.object({sha}).parse(await ghApiJson<unknown>('POST', `repos/${fullName}/git/commits`, { message: 'QA evidence branch (cubefarm)', tree: newTree.sha, parents: [] }));
    const created=z.object({ref:z.literal(`refs/heads/${EVIDENCE_BRANCH}`),object:z.object({type:z.literal('commit'),sha})}).parse(await ghApiJson<unknown>('POST', `repos/${fullName}/git/refs`, { ref: `refs/heads/${EVIDENCE_BRANCH}`, sha: commit.sha }));
    if(created.object.sha.toLowerCase()!==commit.sha.toLowerCase())throw new Error('Evidence branch creation receipt differs from the requested commit');
  }
}

/** Upload one evidence file and return a URL that renders inside PR comments (also for private repos). */
export async function uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string> {
  if(!/^[A-Za-z0-9._/-]{1,1000}$/.test(filePath)||filePath.split('/').some(part=>!part||part==='.'||part==='..')||!Buffer.isBuffer(data)||!data.length||data.length>10*1024*1024)throw new Error('Evidence upload requires a bounded ordinary relative path and nonempty bytes');
  const bytes=Buffer.from(data),key=fullName.toLowerCase(),queue=evidenceUploads.get(key)??{writer:new SerialWriter(),pending:0};
  queue.pending++;evidenceUploads.set(key,queue);
  try{return await queue.writer.write(()=>uploadEvidenceOwned(fullName,filePath,bytes));}
  catch(error){evidenceReady.delete(key);throw error;}
  finally{if(--queue.pending===0&&evidenceUploads.get(key)===queue)evidenceUploads.delete(key);}
}
async function uploadEvidenceOwned(fullName:string,filePath:string,data:Buffer):Promise<string>{
  await ensureEvidenceBranch(fullName);
  const result=await ghApiJson<unknown>('PUT', `repos/${fullName}/contents/${filePath}`, {
    message: `QA evidence: ${filePath}`,
    content: data.toString('base64'),
    branch: EVIDENCE_BRANCH,
  });
  const content=z.object({content:z.object({path:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/i)})}).parse(result).content;
  const expected=crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if(content.path!==filePath||content.sha.toLowerCase()!==expected)throw new Error('GitHub evidence receipt differs from the uploaded path or bytes; inspect the remote outcome before retrying');
  return `https://github.com/${fullName}/raw/${EVIDENCE_BRANCH}/${filePath}`;
}
