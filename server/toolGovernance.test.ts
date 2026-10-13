import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { evaluateToolRequest, ToolGovernanceService, governTool, setToolGovernanceGate, hookDecision, hookFailure } from './toolGovernance.ts';
import { handleHook } from './cliRunner.ts';

const roots: string[] = [];
const checkpoint = { actor: 'qa-1', runtime: 'claude', source: 'cli-hook' } as const;
const fixture = async () => { const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-tool-governance-'));roots.push(root);return root; };
afterEach(async () => {setToolGovernanceGate(async()=>({status:'unavailable',reason:'Not initialized'}));await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});

it('blocks known connector and anonymous-auth requests while retaining diagnostic reads and remediation documentation', () => {
  expect(evaluateToolRequest('Write',{file_path:'Workflows/flow.json',content:'{"connector":"shared_dropbox"}'},false).status).toBe('blocked');
  expect(evaluateToolRequest('Edit',{file_path:'Workflows/flow.yaml',new_string:'authentication:\n  type: None'},false).status).toBe('blocked');
  expect(evaluateToolRequest('mcp__dataverse__update_record',{data:{authentication:{type:'None'}}},false).status).toBe('blocked');
  expect(evaluateToolRequest('Read',{file_path:'Workflows/shared_dropbox.json'},true).status).toBe('allowed');
  expect(evaluateToolRequest('WebFetch',{url:'https://dropbox.com/upload?data=synthetic'},false).status).toBe('blocked');
  expect(evaluateToolRequest('Write',{file_path:'docs/policy.md',content:'Do not use shared_dropbox'},false).status).toBe('allowed');
  expect(evaluateToolRequest('Write',{file_path:'Workflows/flow.json',content:'{"connector":"shared_commondataserviceforapps"}'},false).status).toBe('allowed');
  expect(evaluateToolRequest('Edit',{file_path:'Workflows/shared_dropbox.json',old_string:'shared_dropbox',new_string:'shared_commondataserviceforapps'},false).status).toBe('allowed');
  expect(evaluateToolRequest('apply_patch',{command:'*** Update File: Workflows/flow.json\n-connector: shared_dropbox\n+connector: shared_commondataserviceforapps'},false).status).toBe('allowed');
  expect(evaluateToolRequest('apply_patch',{command:'*** Update File: Workflows/flow.json\n+connector: shared_dropbox'},false).status).toBe('blocked');
});
it('enforces the current Copilot Studio pause without stopping GitHub Copilot coding', () => {
  for(const [tool,input] of [
    ['Bash',{command:'pac copilot publish --bot abc'}],
    ['exec_command',{cmd:'pac copilot publish --bot abc'}],
    ['mcp__copilotstudio__publish',{bot:'abc'}],
    ['Write',{file_path:'C:/repo/CopilotStudio/topic.yaml',content:'kind: topic'}],
    ['apply_patch',{patch:'*** Update File: CopilotStudio/topic.yaml\n+kind: topic'}],
    ['mcp__dataverse__api_request',{path:'/api/data/v9.2/bots(11111111-1111-4111-8111-111111111111)',method:'PATCH'}],
    ['mcp__dataverse__update_record',{tableName:'botcomponent',data:{name:'topic'}}],
    ['mcp__codeapps__add_connector',{connector:'shared_mcscopilot'}],
  ] as const)expect(evaluateToolRequest(tool,input,true).status).toBe('blocked');
  expect(evaluateToolRequest('Bash',{command:'copilot --version'},true).status).toBe('allowed');
  expect(evaluateToolRequest('Bash',{command:'pac copilot publish --bot abc'},false).status).toBe('allowed');
});
it('refuses uninspectable requests instead of approving them', () => {
  for(const input of [null,[],{content:'x'.repeat(1024*1024+1)}])expect(evaluateToolRequest('Write',input,false).status).toBe('unavailable');
  const circular:any={};circular.self=circular;expect(evaluateToolRequest('Write',circular,false).status).toBe('unavailable');
  expect(evaluateToolRequest('invalid tool',{data:'secret'},false).status).toBe('unavailable');
});
it('serializes durable decisions, keeps payloads out of audit and restores counters after restart', async () => {
  const root=await fixture();let paused=true;const service=new ToolGovernanceService(root,()=>paused);await service.init();
  const decisions=await Promise.all(Array.from({length:12},(_,i)=>service.check('Write',{file_path:'Workflows/flow.json',content:i%2?'shared_dropbox':'safe-secret-value'},checkpoint)));
  expect(decisions.filter(d=>d.status==='blocked')).toHaveLength(6);expect(service.view()).toMatchObject({evaluated:12,blocked:6,tenantPolicyVerified:false});
  const bytes=await fs.readFile(path.join(root,'tool-governance.json'),'utf8');expect(bytes).not.toContain('safe-secret-value');expect(bytes).not.toContain('file_path');
  const restored=new ToolGovernanceService(root,()=>paused);await restored.init();expect(restored.view().evaluated).toBe(12);
  paused=false;expect((await restored.check('Bash',{command:'pac copilot publish'},checkpoint)).status).toBe('allowed');
  paused=true;expect((await restored.check('Bash',{command:'pac copilot publish'},checkpoint)).status).toBe('blocked');
  expect(restored.view().recent.at(-1)?.copilotPaused).toBe(true);
});
it('preserves corrupted audit evidence and refuses an uninitialized or failed audit', async () => {
  const root=await fixture(),file=path.join(root,'tool-governance.json');
  const before=new ToolGovernanceService(root,()=>false);expect((await before.check('Read',{},checkpoint)).status).toBe('unavailable');
  await fs.writeFile(file,'broken forensic evidence');await before.init();expect((await before.check('Read',{},checkpoint)).status).toBe('unavailable');expect(await fs.readFile(file,'utf8')).toBe('broken forensic evidence');
  const other=await fixture(),service=new ToolGovernanceService(other,()=>false);await service.init();await fs.mkdir(path.join(other,'tool-governance.json'));
  expect((await service.check('Read',{},checkpoint)).status).toBe('unavailable');expect(service.view().unavailableReason).toContain('could not be saved');expect(service.view().evaluated).toBe(0);
});
it('denies unknown sessions and policy exceptions while leaving observational hook failures nonblocking', async () => {
  const denied:any=await handleHook('missing-session',{hook_event_name:'PreToolUse',tool_name:'Write',tool_input:{}});expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');
  expect(await handleHook('missing-session',{hook_event_name:'Stop'})).toEqual({});
  setToolGovernanceGate(async()=>{throw new Error('secret credential detail');});const decision=await governTool('Write',{},checkpoint);
  expect(decision.status).toBe('unavailable');expect(decision.reason).not.toContain('secret');
  expect((hookDecision(decision) as any).hookSpecificOutput.permissionDecision).toBe('deny');expect(hookFailure({hook_event_name:'PreToolUse'})).toHaveProperty('hookSpecificOutput');expect(hookFailure(null)).toEqual({});
});
