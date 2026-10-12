import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { discoverSkills, selectSkills, type SkillRegistryOptions } from './skillRegistry.ts';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-skills-')); roots.push(root);
  const options: SkillRegistryOptions = { roots: [path.join(root, 'shared')], pluginRoots: [path.join(root, 'cache')], enabledPlugins: ['dataverse@official'] };
  const write = (file: string, value: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const plugin = (version: string, name = 'dataverse') => {
    const dir = path.join(options.pluginRoots[0], 'official', name, version);
    write(path.join(dir, '.codex-plugin', 'plugin.json'), JSON.stringify({ name, version }));
    write(path.join(dir, 'skills', 'dv-solution', 'SKILL.md'), `---\nname: dv-solution\ndescription: Export and import solutions ${version}\n---\nInstructions`);
    return path.join(dir, 'skills', 'dv-solution', 'SKILL.md');
  };
  return { options, write, plugin };
}
it('discovers plugin-only skills, excludes disabled plugins and chooses numeric versions with provenance', () => {
  const { options, plugin } = fixture(); plugin('1.9.0'); plugin('1.11.0'); plugin('9.0.0', 'canvas-apps');
  const catalogue = discoverSkills(options);
  expect(catalogue.skills).toHaveLength(1);
  expect(catalogue.skills[0]).toMatchObject({ id: 'dataverse:dv-solution', version: '1.11.0', platform: 'dataverse', toolStatus: 'unverified' });
  expect(catalogue.warnings.join()).toContain('Verify the active worker');
});
it('invalidates provenance after skill edits and finds new skills without restarting', () => {
  const { options, write, plugin } = fixture(); const file = plugin('1.0.0'); const initial = discoverSkills(options);
  write(file, 'Updated Dataverse instructions');
  expect(discoverSkills(options).fingerprint).not.toBe(initial.fingerprint);
  write(path.join(options.roots[0], 'canvas-apps-canvas-app', 'SKILL.md'), 'Canvas instructions');
  expect(discoverSkills(options).skills).toHaveLength(2);
});
it('selects relevant instructions with a bounded prompt rather than all installed skills', () => {
  const { options, write, plugin } = fixture(); plugin('1.0.0');
  for (const name of ['canvas-apps-canvas-app', 'power-pages-create-site', 'power-automate-build-flow', 'code-apps-add-mcscopilot']) write(path.join(options.roots[0], name, 'SKILL.md'), name);
  const catalogue = discoverSkills(options);
  expect(selectSkills(catalogue, 'Dataverse schema deployment').map((s) => s.platform)).toEqual(['dataverse']);
  expect(selectSkills(catalogue, 'Expense approval', 2)).toHaveLength(2);
  expect(selectSkills(catalogue, 'Copilot Studio lifecycle')).toEqual([]);
});
it('prefers versioned plugin instructions over a shared alias for the same workflow', () => {
  const { options, write, plugin } = fixture(); plugin('1.0.0');
  write(path.join(options.roots[0], 'dataverse-dv-solution', 'SKILL.md'), '---\nname: dv-solution\ndescription: Solutions\n---\nOld alias');
  expect(selectSkills(discoverSkills(options), 'Dataverse solution')).toHaveLength(1);
  expect(selectSkills(discoverSkills(options), 'Dataverse solution')[0].source).toBe('plugin');
});
it('distinguishes cached instructions from configured plugins and honors explicit disablement', () => {
  const { options, plugin, write } = fixture(); plugin('1.0.0'); plugin('3.1.0', 'canvas-apps');
  options.includeUnconfirmedPlugins = true;
  expect(discoverSkills(options).skills.find((skill) => skill.plugin === 'canvas-apps')?.activation).toBe('unconfirmed');
  options.disabledPlugins = ['canvas-apps@official'];
  expect(discoverSkills(options).skills.some((skill) => skill.plugin === 'canvas-apps')).toBe(false);
  write(path.join(options.roots[0], 'code-apps-add-dataverse', 'SKILL.md'), 'Dataverse integration');
  expect(discoverSkills(options).skills.find((skill) => skill.id === 'code-apps-add-dataverse')?.platform).toBe('code-apps');
});
