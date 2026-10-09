import { describe, expect, it } from 'vitest';
import { AgentTerminal } from './terminal.ts';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('AgentTerminal', () => {
  it('ignores malformed websocket messages and accepts valid input', async () => {
    const t = new AgentTerminal();
    const got: string[] = [];
    t.bind({ write: (data) => got.push(data), resize: () => {} });
    const fake = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send: () => {}, close: () => {} });
    t.attach(fake as unknown as WebSocket);
    for (const data of ['null', '1', '"text"', '[]', 'false', '{', '{"t":"resize","cols":null,"rows":"bad"}', '{"t":"input","data":4}']) {
      expect(() => fake.emit('message', data)).not.toThrow();
    }
    expect(got).toEqual([]);
    fake.emit('message', '{"t":"input","data":"hello"}'); expect(got).toEqual(['hello']);
    await t.flush(); t.dispose();
  });
  it('safely overlaps periodic and shutdown saves', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-terminal-save-'));
    const t = new AgentTerminal(); const file = path.join(dir, 'terminal');
    try {
      t.write('first\r\n'); const first = t.save(file);
      t.write('latest\r\n'); const last = t.save(file);
      await Promise.all([first, last]);
      expect(await fs.readFile(file, 'utf8')).toContain('latest'); expect(t.dirty).toBe(false);
      expect(await fs.readdir(dir)).toEqual(['terminal']);
    } finally { t.dispose(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('keeps what was printed, so a late viewer sees the same screen', async () => {
    const t = new AgentTerminal();
    t.write('\x1b[32mhello\x1b[0m world\r\n');
    await t.flush();
    expect(t.screen()).toContain('hello world');
    const again = new AgentTerminal();
    again.write(t.snapshot());
    await again.flush();
    expect(again.screen()).toContain('hello world');
    t.dispose();
    again.dispose();
  });

  it('sends keystrokes and sizes to the running CLI, within sane bounds', () => {
    const t = new AgentTerminal();
    const got: string[] = [];
    t.bind({ write: (d) => got.push(d), resize: (c, r) => got.push(`${c}x${r}`) });
    expect(got).toEqual([`${t.cols}x${t.rows}`]);
    t.resize(5000, 1);
    expect([t.cols, t.rows]).toEqual([400, 5]);
    expect(got.at(-1)).toBe('400x5');
    t.bind(null);
    expect(t.live).toBe(false);
    t.dispose();
  });
});
