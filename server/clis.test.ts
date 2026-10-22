import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CODEX_HOOK_EVENTS, codexHookCommand, hookReviewKey, interruptions, launchArgs, oneAtATime, trustKey, unwrapCmdShim, type LaunchContext } from './clis.ts';
import { describeTool, newScreenshots, screenshotFile, summariseResult } from './agentRunner.ts';

const dir = path.join(os.tmpdir(), 'npm-global');

describe('unwrapCmdShim', () => {
  it('runs node on the script a node shim points at, keeping its node flags', () => {
    const shim = [
      '@ECHO off',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" --no-warnings=DEP0040 "%dp0%\\node_modules\\@acme\\cli\\bin\\cli.js" %*',
    ].join('\r\n');
    expect(unwrapCmdShim(path.join(dir, 'cli.cmd'), shim)).toEqual({ file: process.execPath, args: ['--no-warnings=DEP0040', path.join(dir, 'node_modules\\@acme\\cli\\bin\\cli.js')] });
  });

  it('runs the executable an exe shim points at', () => {
    const shim = '@ECHO off\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n';
    expect(unwrapCmdShim(path.join(dir, 'opencode.cmd'), shim)).toEqual({ file: path.join(dir, 'node_modules\\opencode-ai\\bin\\opencode.exe'), args: [] });
  });

  it('gives up on shims it does not recognise', () => {
    expect(unwrapCmdShim(path.join(dir, 'x.cmd'), '@echo off\r\necho hi\r\n')).toBeNull();
  });
});

describe('trustKey', () => {
  it("moves Claude Code's trust question off its default \"No, exit\", then confirms \"Yes\"", () => {
    const question = (selected: 'no' | 'yes') =>
      [
        'Accessing workspace:',
        'C:\\Users\\me\\.cubefarm\\workspaces\\me__app\\desks\\ada-01df',
        'Quick safety check: Is this a project you created or one you trust?',
        "Claude Code'll be able to read, edit, and execute files here.",
        selected === 'no' ? '❯ No, exit' : '  No, exit',
        selected === 'yes' ? '❯ Yes, I trust this folder' : '  Yes, I trust this folder',
        'Enter to confirm · Esc to cancel',
      ].join('\n');
    expect(trustKey(question('no'))).toBe('down');
    expect(trustKey(question('yes'))).toBe('enter');
  });

  it("confirms Codex's trust question, whose first option is yes", () => {
    const screen = ['> You are in C:\\desk', '  Do you trust the contents of this directory?', '› 1. Yes, continue', '  2. No, quit'].join('\n');
    expect(trustKey(screen)).toBe('enter');
  });

  it('leaves every other screen alone', () => {
    expect(trustKey('❯ Try "refactor <filepath>"')).toBeNull();
  });
});

describe('hookReviewKey', () => {
  const review = (selected: 1 | 3) =>
    ['  Hooks need review', '  5 hooks are new or changed.', `${selected === 1 ? '›' : ' '} 1. Review hooks`, '  2. Trust all and continue', `${selected === 3 ? '›' : ' '} 3. Continue without trusting (hooks won't run)`].join('\n');

  it("goes on without the office's hooks, leaving trust to the manager", () => {
    expect(hookReviewKey(review(1))).toBe('down');
    expect(hookReviewKey(review(3))).toBe('enter');
    expect(hookReviewKey('› Ask Codex to do anything')).toBeNull();
  });
});

describe('interruptions', () => {
  it('counts the lines where a CLI says it interrupted a turn', () => {
    expect(interruptions(['● Bash(sleep 4)', '  ⎿  Interrupted · What should Claude do instead?', '❯ '].join('\n'))).toBe(1);
    expect(interruptions('■ Conversation interrupted - tell the model what to do differently.\n› ')).toBe(1);
    expect(interruptions('● done\n❯ ')).toBe(0);
  });
});

describe('launchArgs', () => {
  const ctx = (patch: Partial<LaunchContext> = {}): LaunchContext => ({
    prompt: '--looks like a flag',
    systemAppend: 'You are Ada.',
    model: 'openai/gpt-synthetic',
    effort: 'medium',
    sessionId: '11111111-1111-1111-1111-111111111111',
    name: 'Ada · #1',
    role: 'dev',
    additionalDirectories: [],
    files: { settings: 'settings.json', mcp: null, system: 'instructions.md' },
    notify: { script: 'notify.cjs', url: 'http://127.0.0.1:1/api/hooks/t' },
    codexHook: 'codex-hook.cjs',
    plugin: 'file:///plugin.mjs',
    browser: null,
    ...patch,
  });
  it.each([undefined,'retained-session'])('disables inherited Playwright in coordinator mode for new/resumed Codex %s',resumeId=>{
    const args=launchArgs('codex',ctx({coordinatorBrowser:true,resumeId,systemAppend:'Own preflight remains required. Browser execution uses browser_handoff.'})).args;
    expect(args.join(' ')).toContain('mcp_servers.playwright=');expect(args.join(' ')).toContain('enabled=false');expect(args.join(' ')).toContain('browser_handoff');expect(args.join(' ')).not.toContain('playwright.js');
  });




  it.each(['claude','copilot'] as const)('rejects %s before constructing launch arguments',cli=>{
    expect(()=>launchArgs(cli,ctx())).toThrow('Only Codex');
  });
  it("runs Codex without its sandbox or approvals, and resumes Codex's thread", () => {
    const fresh = launchArgs('codex', ctx()).args;
    expect(fresh).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(fresh).not.toContain('--sandbox');
    expect(fresh.slice(-2)).toEqual(['--', '--looks like a flag']);
    const resumed = launchArgs('codex', ctx({ resumeId: 'thread-1' })).args;
    expect(resumed[0]).toBe('resume');
    expect(resumed.slice(-2)).toEqual(['thread-1', '--looks like a flag']);
    expect(resumed).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('connects Codex and OpenCode CEOs to session-scoped office tools without losing Playwright', () => {
    const officeUrl = 'http://127.0.0.1:4499/api/mcp/session-token';
    const context = ctx({ role: 'ceo', officeUrl, browser: { command: 'node', args: ['playwright.js'] } });
    for (const resumeId of [undefined, 'existing-thread']) {
      const args = launchArgs('codex', { ...context, resumeId }).args;
      expect(args).toContain(`mcp_servers.office={url=${JSON.stringify(officeUrl)},enabled=true,required=true,startup_timeout_sec=30,tool_timeout_sec=120}`);
      expect(args.some((arg) => arg.startsWith('mcp_servers.playwright='))).toBe(true);
    }
    const config = JSON.parse(launchArgs('opencode', context).env.OPENCODE_CONFIG_CONTENT);
    expect(config.mcp.office).toEqual({ type: 'remote', url: officeUrl, enabled: true });
    expect(config.mcp.playwright.type).toBe('local');
    expect(launchArgs('codex', ctx()).args.some((arg) => arg.startsWith('mcp_servers.office='))).toBe(false);
    expect(JSON.parse(launchArgs('opencode', ctx()).env.OPENCODE_CONFIG_CONTENT).mcp).toBeUndefined();
  });

  it("gives Codex the office's hooks, with the office's address in its environment", () => {
    const { args, env } = launchArgs('codex', ctx());
    const hooks = args.filter((a) => a.startsWith('hooks.'));
    expect(hooks.map((h) => h.slice(6, h.indexOf('=')))).toEqual(CODEX_HOOK_EVENTS);
    expect(hooks[0]).toContain('type="command"');
    expect(env.CUBEFARM_HOOK_URL).toBe('http://127.0.0.1:1/api/hooks/t');
  });

  it.each([undefined,'existing-thread'])('requires reviewed native MCP servers before first turn or resume: %s',resumeId=>{
    const {args}=launchArgs('codex',ctx({resumeId,officeUrl:'http://127.0.0.1:1/api/mcp/test',browser:{command:'node',args:['browser.js']},platformServers:{canvas_authoring:{command:'dotnet',args:['native-canvas']},flowagent:{command:'node',args:['native-flow'],env:{PA_DEFAULT_ENVIRONMENT:'Default-11111111-1111-4111-8111-111111111111'}}}}));
    for(const name of ['office','canvas_authoring','flowagent']){const config=args.find(a=>a.startsWith(`mcp_servers.${name}=`))!;expect(config).toContain('enabled=true,required=true,startup_timeout_sec=');}
    expect(args.find(a=>a.startsWith('mcp_servers.playwright='))).toContain('enabled=true,startup_timeout_sec=60');
    expect(args.find(a=>a.startsWith('mcp_servers.playwright='))).not.toContain('required=true');
    for(const alias of ['canvas-authoring','swarm-flowagent','swarm_flowagent']){const config=args.find(a=>a.startsWith(`mcp_servers.${alias}=`))!;expect(config).toContain('enabled=false');expect(config).not.toContain('required=true');}
    expect(args.find(a=>a.startsWith('mcp_servers.flowagent='))).toContain('PA_DEFAULT_ENVIRONMENT');
  });

  it('runs the hook program with a command that never starts with a quote on Windows', () => {
    expect(codexHookCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\A B\\.cubefarm\\bin\\codex-hook.cjs', true)).toBe('node "C:\\Users\\A B\\.cubefarm\\bin\\codex-hook.cjs"');
    expect(codexHookCommand('/usr/bin/node', "/home/o'neil/.cubefarm/bin/codex-hook.cjs", false)).toBe(`'/usr/bin/node' '/home/o'"'"'neil/.cubefarm/bin/codex-hook.cjs'`);
  });

  it("lets OpenCode run without stopping to ask, and without updating itself", () => {
    const config = (patch: Partial<LaunchContext>) => JSON.parse(launchArgs('opencode', ctx(patch)).env.OPENCODE_CONFIG_CONTENT);
    for (const role of ['dev', 'qa'] as const) expect(config({ role }).permission).toEqual({ edit: 'allow', bash: 'allow', webfetch: 'allow' });
    expect(config({}).autoupdate).toBe(false);
  });


});

describe('oneAtATime', () => {
  it("runs a thread's archive and unarchive in order, other threads alongside, past a step that fails", async () => {
    const steps = oneAtATime();
    const done: string[] = [];
    let release!: () => void;
    const exited = new Promise<void>((r) => (release = r));
    const archive = steps('a', async () => {
      await exited;
      done.push('archive a');
      throw new Error('already archived');
    });
    const unarchive = steps('a', async () => void done.push('unarchive a'));
    await steps('b', async () => void done.push('archive b'));
    expect(done).toEqual(['archive b']);
    release();
    await expect(archive).resolves.toBeUndefined();
    await unarchive;
    expect(done).toEqual(['archive b', 'archive a', 'unarchive a']);
  });
});

describe('screenshotFile', () => {
  it("reads a Playwright screenshot that was saved to a file instead of returned inline", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-shot-'));
    fs.mkdirSync(path.join(cwd, '.playwright-mcp'));
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=','base64');
    fs.writeFileSync(path.join(cwd, '.playwright-mcp', 'pr16-375.png'), png);
    const shot = screenshotFile(cwd, '### Result\n- [Screenshot of viewport](.playwright-mcp/pr16-375.png)');
    expect(shot?.mime).toBe('image/png');
    expect(shot?.data).toEqual(png);
    expect(screenshotFile(cwd, '### Result\n- no link here')).toBeNull();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("Codex's file edits in the log", () => {
  it('names the files an apply_patch touches, and says when it worked', () => {
    const patch = '*** Begin Patch\n*** Add File: notes.txt\n+hi\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch';
    expect(describeTool(dir, 'apply_patch', { command: patch })).toBe('Edit add notes.txt, src/app.ts');
    expect(summariseResult(dir, 'apply_patch', 'Exit code: 0\nOutput:\nSuccess. Updated the following files:\nA notes.txt')).toEqual([{ kind: 'result', text: '  ⎿ Updated' }]);
    expect(summariseResult(dir, 'apply_patch', 'error: patch did not apply')[0].text).toContain('patch did not apply');
  });
});

describe('newScreenshots', () => {
  it("picks up the images a browser saved, oldest first, once they're written and only once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-'));
    const later = Date.now() + 5000;
    for (const f of ['page-2026-09-29T10-00-02-000Z.jpeg', 'page-2026-09-29T10-00-01-000Z.png', 'page-2026-09-29T10-00-00-000Z.yml']) fs.writeFileSync(path.join(dir, f), 'fixture');
    const seen = new Set<string>();
    expect(newScreenshots(dir, seen)).toEqual([]); // just written: may still be in progress
    const found = newScreenshots(dir, seen, later);
    expect(found.map((s) => [s.name, s.mime])).toEqual([
      ['page-2026-09-29T10-00-01-000Z.png', 'image/png'],
      ['page-2026-09-29T10-00-02-000Z.jpeg', 'image/jpeg'],
    ]);
    seen.add(found[0].name);
    expect(newScreenshots(dir, seen, later).map((s) => s.name)).toEqual(['page-2026-09-29T10-00-02-000Z.jpeg']);
    expect(newScreenshots(path.join(dir, 'missing'), seen, later)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

it('recognizes only Gemini native cancellation notices rather than quoted task text',()=>{
 expect(interruptions('ℹ User cancelled the request.\nType your message','gemini')).toBe(1);
 expect(interruptions('User cancelled the request.\nUser cancelled the request.','gemini')).toBe(2);
 expect(interruptions('ℹ Request cancelled.','gemini')).toBe(1);
 for(const screen of ['Please print User cancelled the request.','"User cancelled the request."','The model was interrupted','Error: User cancelled the request.'])expect(interruptions(screen,'gemini')).toBe(0);
});
