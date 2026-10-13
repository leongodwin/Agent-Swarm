import { describe, expect, it } from 'vitest';
import { codexCapacityIdle,codexRecoveredIdle,copilotResponse, lostConversation, resumableSession } from './cliRunner.ts';

describe('copilotResponse', () => {
  it('returns plain text without terminal styling', () => {
    expect(copilotResponse('\u001b[32mDone\u001b[0m\r\nCreated the pull request.\r\n')).toBe('Done\nCreated the pull request.');
  });
});

describe('resumableSession', () => {
  const onDisk = (files: string[]) => (file: string) => files.includes(file);
  const hook = { hook_event_name: 'PreToolUse', session_id: 'abc', transcript_path: 'abc.jsonl' };

  it("keeps the session once Claude Code's conversation file exists", () => {
    expect(resumableSession(hook, onDisk(['abc.jsonl']))).toBe('abc');
  });

  it("doesn't keep it while the file isn't written yet (SessionStart, UserPromptSubmit)", () => {
    expect(resumableSession({ ...hook, hook_event_name: 'UserPromptSubmit' }, onDisk([]))).toBeNull();
  });

  it("doesn't keep it from a call with no transcript path (the status line) or no session", () => {
    expect(resumableSession({ hook_event_name: 'StatusLine', session_id: 'abc' }, () => true)).toBeNull();
    expect(resumableSession({ hook_event_name: 'Stop', transcript_path: 'abc.jsonl' }, () => true)).toBeNull();
  });
});

describe('lostConversation', () => {
  it("spots Claude Code's message for a resume with nothing to resume", () => {
    expect(lostConversation('\n No conversation found with session ID: 6cc74c7e-0c81-4bff-a140-cc8307c1d11b\n')).toBe(true);
  });

  it('ignores other screens', () => {
    expect(lostConversation('Claude Code v2.1.280\n❯ ')).toBe(false);
  });
});
describe('Codex capacity idle observation',()=>{
  const failed='■ Selected model is at capacity. Please try a different model.\n› Ask Codex to do anything\n(the office restarted)';
  it('recognizes a native failure at its idle prompt after restart',()=>expect(codexCapacityIdle(failed)).toBe(true));
  it.each(['Selected model is at capacity.\n› Ask Codex to do anything',failed+'\nesc to interrupt',failed+'\nWorking (10s)',failed.replace('› Ask Codex to do anything','Sign in')])('rejects task text, active work and non-idle screens',screen=>expect(codexCapacityIdle(screen)).toBe(false));
});

describe('retained Codex idle recovery observation',()=>{
  const idle='• Work finished\n  Worked for 19m 44s • 12:06\n› Ask Codex to do anything\n(the office restarted)';
  it('recognizes native completed-turn footer and idle prompt',()=>expect(codexRecoveredIdle(idle)).toBe(true));
  it.each([idle+'\nesc to interrupt',idle+'\nWorking (10s)',idle+'\nThinking (2s)',idle.replace('Worked for 19m 44s','Task says completed'),idle.replace('› Ask Codex to do anything','› pending prompt')])('rejects active and incomplete observations',screen=>expect(codexRecoveredIdle(screen)).toBe(false));
});
