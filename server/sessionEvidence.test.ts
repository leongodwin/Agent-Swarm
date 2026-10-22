import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {SessionEvidence,evidenceHash,summarizeSessionEvidence,evidenceRevision,readSessionAttempts} from './sessionEvidence.ts';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'session-evidence-'));roots.push(home);return home;}
const context={agentId:'synthetic',runtime:'codex',role:'dev',sourceRevision:null,taskSha256:evidenceHash('private task'),resumed:false};
it('retains failed attempts and retries separately, with explicit unknown usage and no raw payloads',()=>{
  const home=fixture();const first=new SessionEvidence(home,context),retry=new SessionEvidence(home,{...context,resumed:true});
  expect(first.record({kind:'start',inputTokens:null,outputTokens:null,costUsd:null})).toBe(true);
  first.record({kind:'tool',tool:'mcp__platform__inspect',inputSha256:evidenceHash({secret:'credential'})});
  first.record({kind:'finish',outcome:'failure',reason:'preflight'});retry.record({kind:'start'});retry.record({kind:'finish',outcome:'success'});
  const files=fs.readdirSync(path.join(home,'session-evidence'));expect(files).toHaveLength(2);
  const bytes=files.map(file=>fs.readFileSync(path.join(home,'session-evidence',file),'utf8')).join('');
  expect(bytes).not.toContain('credential');expect(bytes).not.toContain('private task');
  const rows=bytes.trim().split('\n').map(line=>JSON.parse(line));expect(rows.filter(row=>row.kind==='finish').map(row=>row.outcome).sort()).toEqual(['failure','success']);
  expect(rows.find(row=>row.kind==='start'&&row.attemptId===first.id)).toMatchObject({inputTokens:null,outputTokens:null,costUsd:null,sourceRevision:null});
  expect(new Set(rows.map(row=>row.attemptId)).size).toBe(2);
  expect(summarizeSessionEvidence(home)).toMatchObject({attempts:2,success:1,failure:1,unknownTokenUsage:2,costMeasuredAttempts:0});
});
it('fails closed and preserves existing bytes when evidence storage is unavailable',()=>{
  const home=fixture();fs.writeFileSync(path.join(home,'session-evidence'),'preserve');
  const audit=new SessionEvidence(home,context);expect(audit.record({kind:'start'})).toBe(false);
  expect(audit.record({kind:'finish',outcome:'success'})).toBe(false);expect(fs.readFileSync(path.join(home,'session-evidence'),'utf8')).toBe('preserve');
});
it('rejects nonfinite usage rather than manufacturing a measurement',()=>{
  const audit=new SessionEvidence(fixture(),context);expect(audit.record({kind:'usage',inputTokens:NaN})).toBe(false);
});
it('counts incomplete and unreadable attempts without silently excluding them',()=>{
  const home=fixture(),audit=new SessionEvidence(home,context);audit.record({kind:'start'});
  const broken=new SessionEvidence(home,context);broken.record({kind:'start'});
  fs.appendFileSync(path.join(home,'session-evidence',`${broken.id}.jsonl`),'interrupted write');
  expect(summarizeSessionEvidence(home)).toMatchObject({attempts:2,incomplete:1,unreadable:1,success:0});
});
it('reads detached, symbolic and worktree HEADs without invoking Git and leaves missing provenance unknown',()=>{
  const root=fixture();expect(evidenceRevision(root)).toBeNull();
  const git=path.join(root,'.git');fs.mkdirSync(git);const sha='a'.repeat(40);
  fs.writeFileSync(path.join(git,'HEAD'),sha);expect(evidenceRevision(root)).toBe(sha);
  fs.writeFileSync(path.join(git,'HEAD'),'ref: refs/heads/main');fs.writeFileSync(path.join(git,'packed-refs'),`${sha} refs/heads/main\n`);expect(evidenceRevision(root)).toBe(sha);
  const worktree=path.join(root,'desk'),metadata=path.join(git,'worktrees','desk');fs.mkdirSync(worktree);fs.mkdirSync(metadata,{recursive:true});
  fs.writeFileSync(path.join(worktree,'.git'),`gitdir: ${metadata}`);fs.writeFileSync(path.join(metadata,'HEAD'),'ref: refs/heads/main');fs.writeFileSync(path.join(metadata,'commondir'),'../..');expect(evidenceRevision(worktree)).toBe(sha);
});

it.each(['finish-only','identity','timestamp','finish-followed-by-tool','double-start','sequence','utf8','no-newline'])('keeps both reports from treating malformed %s attempts as native usage',mode=>{
 const home=fixture(),audit=new SessionEvidence(home,{...context,runtime:'opencode'});audit.record({kind:'start'});audit.record({kind:'finish',outcome:'success',usageCoverage:'complete',usageScope:'attempt',usageSource:'opencode-message-v1',inputTokens:10,outputTokens:2,costUsd:0.5});const file=path.join(home,'session-evidence',audit.id+'.jsonl'),rows=fs.readFileSync(file,'utf8').trim().split('\n').map(x=>JSON.parse(x));
 if(mode==='finish-only'){rows.shift();rows[0].sequence=1;}if(mode==='identity')rows[1].agentId='other';if(mode==='timestamp')rows[1].at='2000-01-01T00:00:00.000Z';if(mode==='double-start')rows[1].kind='start';if(mode==='sequence')rows[1].sequence=3;if(mode==='finish-followed-by-tool')rows.push({...rows[0],sequence:3,kind:'tool'});
 fs.writeFileSync(file,mode==='utf8'?Buffer.from([0xff,10]):rows.map(x=>JSON.stringify(x)).join('\n')+(mode==='no-newline'?'':'\n'));expect(readSessionAttempts(home)[0].unreadable).toBe(true);expect(summarizeSessionEvidence(home)).toMatchObject({success:0,unreadable:1,unknownTokenUsage:1,observedCostUsd:null,costMeasuredAttempts:0});
});
it('separates proven native work, legacy unknown counters and interrupted attempts in the offline report',()=>{
 const home=fixture();for(const [runtime,coverage,outcome]of [['opencode','complete','success'],['codex','complete','interrupted'],['opencode','partial','failure']] as const){const a=new SessionEvidence(home,{...context,runtime});a.record({kind:'start'});a.record({kind:'tool',outcome:'blocked'});a.record({kind:'finish',outcome,usageCoverage:coverage,usageScope:'attempt',usageSource:'opencode-message-v1',inputTokens:10,outputTokens:5,costUsd:1});}
 expect(summarizeSessionEvidence(home)).toMatchObject({attempts:3,success:1,interrupted:1,failure:1,blockedToolCalls:3,unknownTokenUsage:2,observedCostUsd:1,costMeasuredAttempts:1});
});
it('rejects evidence symlink traversal rather than reading unrelated bytes',()=>{
 const home=fixture(),outside=fixture();const a=new SessionEvidence(outside,context);a.record({kind:'start'});fs.symlinkSync(path.join(outside,'session-evidence'),path.join(home,'session-evidence'),process.platform==='win32'?'junction':'dir');expect(()=>readSessionAttempts(home)).toThrow('directory unavailable');expect(()=>summarizeSessionEvidence(home)).toThrow('directory unavailable');
});
it('leaves missing Git metadata and malformed ref records unknown without running commands',()=>{const home=fixture(),dir=path.join(home,'.git');fs.writeFileSync(dir,'not a gitdir link');expect(evidenceRevision(home)).toBeNull();fs.rmSync(dir);fs.mkdirSync(dir);for(const ref of ['ref: refs/heads/../escape','ref: refs//heads/main','ref: refs/heads/main']){fs.writeFileSync(path.join(dir,'HEAD'),ref);if(ref.endsWith('main')){fs.mkdirSync(path.join(dir,'refs','heads'),{recursive:true});fs.writeFileSync(path.join(dir,'refs','heads','main'),'invalid-sha');}expect(evidenceRevision(home)).toBeNull();}const circular:any={};circular.self=circular;expect(evidenceHash(circular)).toMatch(/^[a-f0-9]{64}$/);expect(evidenceHash(undefined)).toBe(evidenceHash(null));});

it.each(['codex','gemini'] as const)('summarizes complete %s tokens without inventing USD and rejects cross-runtime provenance',runtime=>{
 const home=fixture(),source=runtime==='codex'?'codex-response-v1':'gemini-session-v1';
 for(const usageSource of [source,'opencode-message-v1'] as const){const evidence=new SessionEvidence(home,{...context,runtime});evidence.record({kind:'start'});evidence.record({kind:'finish',outcome:'success',usageCoverage:'complete',usageScope:'attempt',usageSource,inputTokens:10,outputTokens:4,costUsd:null});}
 expect(summarizeSessionEvidence(home)).toMatchObject({attempts:2,unknownTokenUsage:1,observedCostUsd:null,costMeasuredAttempts:0});
});
