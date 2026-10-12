import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export interface InstalledSkill {
  id: string; name: string; platform: string; file: string; source: 'shared' | 'plugin';
  plugin?: string; version?: string; activation?: 'configured' | 'unconfirmed'; sha256: string; description: string; toolStatus: 'unverified';
}
export interface SkillCatalogue { fingerprint: string; skills: InstalledSkill[]; warnings: string[] }
export interface SkillRegistryOptions { roots: string[]; pluginRoots: string[]; enabledPlugins: string[]; disabledPlugins?: string[]; includeUnconfirmedPlugins?: boolean; }
function read(file: string) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function directories(root: string) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); }
  catch { return []; }
}
function metadata(source: string, field: string) {
  const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!front) return '';
  return front[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1].replace(/^['"]|['"]$/g, '').trim() ?? '';
}
function platformFor(name: string) {
  if (/^(dataverse(?:$|[-/:])|dv-)/.test(name)) return 'dataverse';
  if (/canvas/.test(name)) return 'canvas';
  if (/power-pages/.test(name)) return 'power-pages';
  if (/power-automate/.test(name)) return 'power-automate';
  if (/model-apps/.test(name)) return 'model-driven';
  if (/code-apps/.test(name)) return 'code-apps';
  if (/mobile/.test(name)) return 'mobile';
  if (/copilot-studio/.test(name)) return 'copilot-studio';
  if (/mcp-apps/.test(name)) return 'mcp-apps';
  return undefined;
}
export function defaultSkillOptions(): SkillRegistryOptions {
  const home = os.homedir(); const codex = process.env.CODEX_HOME ?? path.join(home, '.codex');
  const config = read(path.join(codex, 'config.toml'));
  const plugins = [...config.matchAll(/^\[plugins\."([^"\r\n]+)"\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)];
  const enabledPlugins = plugins.filter((match) => /^enabled\s*=\s*true\s*$/m.test(match[2])).map((match) => match[1]);
  const disabledPlugins = plugins.filter((match) => /^enabled\s*=\s*false\s*$/m.test(match[2])).map((match) => match[1]);
  return { roots: [path.join(home, '.agents', 'skills'), path.join(codex, 'skills'), ...(process.env.SWARM_SKILL_ROOTS ?? '').split(path.delimiter).filter(Boolean)],
    pluginRoots: [path.join(codex, 'plugins', 'cache'), ...(process.env.SWARM_PLUGIN_ROOTS ?? '').split(path.delimiter).filter(Boolean)], enabledPlugins, disabledPlugins, includeUnconfirmedPlugins: true };
}

/** Local instructions do not establish runtime tool or tenant access. */
export function discoverSkills(options = defaultSkillOptions()): SkillCatalogue {
  const skills: InstalledSkill[] = [], warnings: string[] = []; const seen = new Set<string>();
  const add = (file: string, alias: string, source: InstalledSkill['source'], plugin?: string, version?: string) => {
    let real: string; try { real = fs.realpathSync(file); } catch { return; }
    if (seen.has(real)) return;
    const content = read(real); if (!content) return;
    const platform = platformFor(plugin ? `${plugin}-${alias}` : alias); if (!platform) return;
    seen.add(real);
    skills.push({ id: plugin ? `${plugin}:${alias}` : alias, name: metadata(content, 'name') || alias, platform, file: real, source, plugin, version,
      sha256: crypto.createHash('sha256').update(content).digest('hex'), description: metadata(content, 'description').slice(0, 350), toolStatus: 'unverified' });
  };
  for (const root of options.roots) for (const name of directories(root)) {
    add(path.join(root, name, 'SKILL.md'), name, 'shared');
    for (const child of directories(path.join(root, name))) add(path.join(root, name, child, 'SKILL.md'), `${name}/${child}`, 'shared');
  }
  for (const cache of options.pluginRoots) for (const market of directories(cache)) for (const plugin of directories(path.join(cache, market))) {
    if (!platformFor(plugin)) continue;
    const key = `${plugin}@${market}`;
    if (options.disabledPlugins?.includes(key) || !options.enabledPlugins.includes(key) && !options.includeUnconfirmedPlugins) continue;
    if (!options.enabledPlugins.includes(key)) warnings.push(`${key}: cached instructions found; activation in this worker is unconfirmed. Verify runtime availability.`);
    const versions = directories(path.join(cache, market, plugin)).filter((v) => /^\d+(\.\d+){1,3}$/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const version = versions[0]; if (!version) continue;
    if (versions.length > 1) warnings.push(`${key}: multiple cached versions; catalogue uses ${version}. Verify the active worker plugin before using it.`);
    const dir = path.join(cache, market, plugin, version);
    const manifest = ['.codex-plugin', '.claude-plugin'].map((folder) => read(path.join(dir, folder, 'plugin.json'))).find(Boolean);
    try { if (!manifest || JSON.parse(manifest).name !== plugin) { warnings.push(`${key}: invalid plugin manifest; skipped`); continue; } }
    catch { warnings.push(`${key}: invalid plugin manifest; skipped`); continue; }
    const before = skills.length;
    for (const name of directories(path.join(dir, 'skills'))) add(path.join(dir, 'skills', name, 'SKILL.md'), name, 'plugin', plugin, version);
    for (const skill of skills.slice(before)) skill.activation = options.enabledPlugins.includes(key) ? 'configured' : 'unconfirmed';
  }
  skills.sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file));
  return { fingerprint: crypto.createHash('sha256').update(JSON.stringify({ options, skills, warnings })).digest('hex'), skills, warnings };
}

export function selectSkills(catalogue: SkillCatalogue, task: string, limit = 8) {
  const tokens = task.toLowerCase(); const platforms = new Set<string>();
  if (/canvas|expense|power apps/.test(tokens)) platforms.add('canvas');
  if (/dataverse|table|schema|security|expense/.test(tokens)) platforms.add('dataverse');
  if (/flow|approval|notification|power automate/.test(tokens)) platforms.add('power-automate');
  if (/power pages|portal|website/.test(tokens)) platforms.add('power-pages');
  if (/model.driven/.test(tokens)) platforms.add('model-driven');
  if (/code app/.test(tokens)) platforms.add('code-apps');
  if (/mobile|offline/.test(tokens)) platforms.add('mobile');
  if (/copilot/.test(tokens)) platforms.add('copilot-studio');
  const words = tokens.match(/[a-z][a-z-]{3,}/g) ?? [];
  const candidates = new Map<string, InstalledSkill>();
  for (const skill of catalogue.skills) {
    const identity = `${skill.platform}:${skill.name}`;
    const previous = candidates.get(identity);
    if (!previous || skill.source === 'plugin' && previous.source !== 'plugin') candidates.set(identity, skill);
  }
  return [...candidates.values()].map((skill) => ({ skill, score: words.filter((word) => `${skill.id} ${skill.description}`.toLowerCase().includes(word)).length +
    (/canvas-app$|dv-overview|build-flow|create-site|app-builder|create-code-app/.test(skill.id) ? 2 : 0) }))
    .filter(({ skill }) => platforms.has(skill.platform)).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, limit).map(({ skill }) => skill);
}
