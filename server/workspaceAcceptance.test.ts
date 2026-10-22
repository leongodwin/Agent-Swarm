import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => ({ git: vi.fn(), gh: vi.fn(), run: vi.fn() }));
vi.mock('./exec.ts', () => exec);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Agent Swarm workspace QA '));
vi.mock('./config.ts', () => ({ WORKSPACE_ROOT: path.join(root, 'workspaces'), RESOURCE_LEASE_ROOT: path.join(root, 'leases') }));
const workspace = await import('./workspace.ts');
afterAll(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 8 }); });
beforeEach(() => { exec.git.mockReset().mockResolvedValue(''); exec.gh.mockReset().mockResolvedValue(''); exec.run.mockReset().mockResolvedValue(''); });
let seq = 0;
async function folder(config?: string) {
  const dir = path.join(root, `project ${++seq}`); await fs.mkdir(dir);
  if (config !== undefined) { await fs.mkdir(path.join(dir, '.git')); await fs.writeFile(path.join(dir, '.git', 'config'), config); }
  return dir;
}

describe('workspace discovery and publication boundaries', () => {
  it.each(['https://github.com/owner/repo.git', 'git@github.com:owner/repo.git', 'https://GITHUB.com/owner/repo/'])('recognises origin %s', async url => {
    const dir = await folder(`[remote "upstream"]\nurl = https://elsewhere.test/nope\n[remote "origin"]\nurl = ${url}\n`);
    expect(await workspace.inspectFolder(dir)).toMatchObject({ path: dir, git: true, github: 'owner/repo' });
  });
  it('rejects files and missing folders, keeps plain folders and non-GitHub origins local', async () => {
    const dir = await folder(); expect(await workspace.inspectFolder(dir)).toMatchObject({ git: false, github: null });
    const file = path.join(dir, 'file'); await fs.writeFile(file, 'x');
    await expect(workspace.inspectFolder(file)).rejects.toThrow('not a folder'); await expect(workspace.inspectFolder(path.join(dir, 'missing'))).rejects.toThrow('not a folder');
    expect((await workspace.inspectFolder(await folder('[remote "origin"]\nurl = https://gitlab.com/owner/repo'))).github).toBeNull();
  });
  it('reads worktree common configuration and tolerates malformed gitdir markers', async () => {
    const dir = await folder(), common = path.join(dir, 'common'), gitdir = path.join(common, 'worktrees', 'desk');
    await fs.mkdir(gitdir, { recursive: true }); await fs.writeFile(path.join(common, 'config'), '[remote "origin"]\nurl = git@github.com:owner/worktree.git');
    await fs.writeFile(path.join(dir, '.git'), `gitdir: ${path.relative(dir, gitdir)}\n`);
    expect((await workspace.inspectFolder(dir)).github).toBe('owner/worktree');
    await fs.writeFile(path.join(dir, '.git'), 'invalid'); expect((await workspace.inspectFolder(dir)).github).toBeNull();
  });
  it('scans visible directories only in modification order and reports unreadable roots', async () => {
    const dir = await folder();
    for (const name of ['old', 'recent', '.hidden', 'node_modules']) await fs.mkdir(path.join(dir, name));
    await fs.writeFile(path.join(dir, 'file'), 'x'); await fs.utimes(path.join(dir, 'old'), 1, 1); await fs.utimes(path.join(dir, 'recent'), 10, 10);
    expect((await workspace.scanProjects(dir)).map(f => f.name)).toEqual(['recent', 'old']);
    await expect(workspace.scanProjects(path.join(dir, 'missing'))).rejects.toThrow("Can't read");
  });
  it('returns an existing GitHub origin without committing or publishing', async () => {
    const dir = await folder('[remote "origin"]\nurl = https://github.com/owner/existing.git');
    expect(await workspace.publishFolder(dir, { name: 'ignored', visibility: 'public' })).toBe('owner/existing');
    expect(exec.git).not.toHaveBeenCalled(); expect(exec.gh).not.toHaveBeenCalled();
  });
  it('refuses to choose unpublished files for an initial commit', async () => {
    const dir = await folder(); await fs.writeFile(path.join(dir, 'private.txt'), 'keep local');
    exec.git.mockImplementation(async args => { if (args[0] === 'rev-parse') throw new Error('no commits'); return ''; });
    await expect(workspace.publishFolder(dir, { name: 'demo', visibility: 'private' })).rejects.toThrow('Commit what you want');
    expect(exec.gh).not.toHaveBeenCalled(); expect(await fs.readFile(path.join(dir, 'private.txt'), 'utf8')).toBe('keep local');
    expect(exec.git.mock.calls.some(([args]) => args[0] === 'add')).toBe(false);
  });
  it('creates only a README initial commit, supplies identity only when required and passes publication arguments separately', async () => {
    const dir = await folder(); let committed = false;
    exec.git.mockImplementation(async args => {
      if (args[0] === 'rev-parse') throw new Error('no commit');
      if (args[0] === 'commit' && !committed) { committed = true; throw new Error('Please tell me who you are'); }
      return '';
    });
    exec.gh.mockImplementation(async args => args[0] === 'api' ? 'demo-user' : 'https://github.com/demo-co/demo-name.git\n');
    expect(await workspace.publishFolder(dir, { name: 'demo-name', owner: 'demo-co', visibility: 'private', description: ' example ' })).toBe('demo-co/demo-name');
    expect(await fs.readFile(path.join(dir, 'README.md'), 'utf8')).toBe('# demo-name\n\nexample\n');
    expect(exec.git).toHaveBeenCalledWith(['-c', 'user.name=demo-user', '-c', 'user.email=demo-user@users.noreply.github.com', 'commit', '-m', 'Initial commit'], { cwd: dir });
    expect(exec.gh).toHaveBeenCalledWith(['repo', 'create', 'demo-co/demo-name', '--private', '--source', dir, '--remote', 'origin', '--push', '--description', ' example '], { cwd: dir, timeoutMs: 120000 });
  });
  it('preserves README content and propagates commit errors unrelated to identity', async () => {
    const dir = await folder(); await fs.writeFile(path.join(dir, 'README.md'), 'existing');
    exec.git.mockImplementation(async args => { if (args[0] === 'rev-parse') throw new Error('none'); if (args[0] === 'commit') throw new Error('disk full'); return ''; });
    await expect(workspace.publishFolder(dir, { name: 'demo', visibility: 'private' })).rejects.toThrow('disk full');
    expect(await fs.readFile(path.join(dir, 'README.md'), 'utf8')).toBe('existing'); expect(exec.gh).not.toHaveBeenCalled();
  });
  it('rejects foreign origins and returns explicit target when the provider has no URL', async () => {
    const dir = await folder(); exec.git.mockImplementation(async args => args[0] === 'remote' ? 'https://gitlab.com/owner/repo' : '');
    await expect(workspace.publishFolder(dir, { name: 'demo', visibility: 'private' })).rejects.toThrow("isn't on GitHub"); expect(exec.gh).not.toHaveBeenCalled();
    exec.git.mockResolvedValue(''); expect(await workspace.publishFolder(dir, { name: 'demo', owner: 'owner', visibility: 'public' })).toBe('owner/demo');
  });
  it('does not overwrite an existing project and creates a new empty project with the intended README', async () => {
    const dir = await folder(); await fs.mkdir(path.join(dir, 'occupied')); await fs.writeFile(path.join(dir, 'occupied', 'keep'), 'x');
    await expect(workspace.createProject(dir, 'occupied', { visibility: 'private' })).rejects.toThrow('already exists');
    expect(exec.git).not.toHaveBeenCalled(); expect(await workspace.createProject(dir, 'new', { visibility: 'private' })).toEqual({ fullName: 'new', path: path.join(dir, 'new') });
    expect(await fs.readFile(path.join(dir, 'new', 'README.md'), 'utf8')).toBe('# new\n\n\n');
  });
  it('keeps local root overrides case insensitive and exclusion updates idempotent', async () => {
    const dir = await folder(''); workspace.setLocalPath('Owner/Project', dir); expect(workspace.mainDir('owner/project')).toBe(dir);
    await workspace.ensureLocalExcludes('owner/project'); const content = await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(content).toContain('.playwright-mcp/'); expect(content).toContain('.preview-tmp/'); await workspace.ensureLocalExcludes('OWNER/PROJECT');
    expect(await fs.readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8')).toBe(content);
    workspace.setLocalPath('OWNER/PROJECT', null); expect(workspace.mainDir('owner/project')).not.toBe(dir);
  });
  it('clones only absent repositories, fetches existing checkouts and preserves existing exclusions', async () => {
    const name = `qa/clone-${++seq}`, main = workspace.mainDir(name);
    exec.gh.mockResolvedValue(''); await workspace.ensureClone(name);
    expect(exec.gh).toHaveBeenCalledWith(['repo', 'clone', name, main], { timeoutMs: 600000 });
    const exclude = path.join(main, '.git', 'info', 'exclude'); await fs.writeFile(exclude, 'existing-no-newline');
    await workspace.ensureClone(name); expect(exec.git).toHaveBeenCalledWith(['fetch', 'origin', '--prune'], { cwd: main, timeoutMs: 180000 });
    expect(await fs.readFile(exclude, 'utf8')).toMatch(/^existing-no-newline\n# added/);
    const before = await fs.readFile(exclude, 'utf8'); await workspace.ensureClone(name); expect(await fs.readFile(exclude, 'utf8')).toBe(before);
  });
  it('serialises repository failures without poisoning later clone attempts', async () => {
    const name = `qa/failed-${++seq}`; exec.gh.mockRejectedValueOnce(new Error('synthetic clone failure'));
    await expect(workspace.ensureClone(name)).rejects.toThrow('clone failure'); await workspace.ensureClone(name); expect(exec.gh).toHaveBeenCalledTimes(2);
  });
  it('reports missing branch and pull-request references before attempting a worktree mutation', async () => {
    exec.git.mockImplementation(async args => { if (args[0] === 'rev-parse') throw new Error('missing ref'); return ''; });
    await expect(workspace.prepareDesk('qa/missing', { defaultBranch: 'main' }, 'desk', 'swarm/desk')).rejects.toThrow('Push an initial commit');
    await expect(workspace.prepareDesk('qa/missing', { defaultBranch: 'main', pr: 9 }, 'desk', 'swarm/desk')).rejects.toThrow('Could not fetch pull request #9');
    expect(exec.git.mock.calls.some(([args]) => args[0] === 'worktree')).toBe(false);
    await workspace.removeDesk('qa/missing', 'absent');
  });
  it('refuses non-worktree desk contents and symbolic link desk targets', async () => {
    const name = `qa/desk-${++seq}`, main = workspace.mainDir(name); await fs.mkdir(path.join(main, '.git'), { recursive: true });
    exec.git.mockImplementation(async args => { if (args.includes('--git-common-dir')) return path.join(main, '.git'); if (args[0] === 'rev-parse' && args[2]?.startsWith('refs/heads')) throw new Error('no local branch'); return ''; });
    const desk = workspace.deskDir(name, 'occupied'); await fs.mkdir(desk, { recursive: true }); await fs.writeFile(path.join(desk, 'keep'), 'unfinished');
    await expect(workspace.prepareDesk(name, { defaultBranch: 'main' }, 'occupied', 'swarm/desk')).rejects.toThrow('contains files'); expect(await fs.readFile(path.join(desk, 'keep'), 'utf8')).toBe('unfinished');
    const linked = workspace.deskDir(name, 'linked'); await fs.symlink(desk, linked, 'junction');
    await expect(workspace.prepareDesk(name, { defaultBranch: 'main' }, 'linked', 'swarm/desk')).rejects.toThrow('symbolic link');
  });
  it('never kills protected processes or editors while cleaning Unix desk leftovers', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'linux' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('already gone'); });
    const name = 'qa/processes', desk = workspace.deskDir(name, 'desk');
    exec.run.mockResolvedValue(`123 node ${desk}/server.js\n124 node ${desk}/protected.js\n125 code ${desk}\n${process.pid} node ${desk}/self.js\n126 node ${desk}/other.js session-marker\n`);
    try { await workspace.releaseDesk(name, 'desk', 0, { pids: [124], markers: ['session-marker'] }); expect(kill).toHaveBeenCalledExactlyOnceWith(123, 'SIGKILL');
      exec.run.mockRejectedValue(new Error('ps unavailable')); await workspace.releaseDesk(name, 'desk', 0); expect(kill).toHaveBeenCalledTimes(1);
    } finally { kill.mockRestore(); Object.defineProperty(process, 'platform', descriptor); }
  });
  it('passes Windows cleanup as data to a hidden process runner and tolerates discovery failures', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'win32' });
    try { exec.run.mockRejectedValue(new Error('synthetic unavailable')); await workspace.releaseDesk('qa/processes', 'desk', 0, { pids: [124], markers: ["marker'quoted"] });
      expect(exec.run).toHaveBeenCalledWith('powershell', ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining("marker''quoted")], { timeoutMs: 30000 });
      expect(exec.run.mock.calls[0][1][3]).toContain('CreationDate -eq');
    } finally { Object.defineProperty(process, 'platform', descriptor); }
  });
});
