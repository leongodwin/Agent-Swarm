import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './httpError.ts';

const recipes = {
  canvas: { skill: 'canvas-apps:canvas-app', tools: ['sync_canvas', 'compile_canvas', 'get_data_source_schema'], steps: ['Synchronize a dedicated empty app directory through Canvas Authoring.', 'Discover control and data-source schemas from the connected tools.', 'Implement the approved action contracts and responsive screens.', 'Compile to zero errors and package the actual .msapp; invented YAML is not an output.'] },
  'power-pages': { skill: 'power-pages:create-site', tools: ['browser_navigate', 'browser_snapshot'], steps: ['Select a curated template through the installed Power Pages creation skill.', 'Apply the experience brief and shared design tokens.', 'Configure authentication, web roles and table permissions.', 'Upload, activate and verify the actual site through the deployment skill.'] },
  dataverse: { skill: 'dataverse:dv-solution', tools: [], steps: ['Discover the existing publisher and prefix; do not invent a publisher.', 'Discover the connected Dataverse tools or use the skill SDK for tables, relationships and least-privilege roles.', 'Include actual components in the named solution.', 'Export source and pack with the supported PAC CLI.'] },
  flow: { skill: 'power-automate:build-flow', tools: ['list_templates', 'scaffold_flow', 'get_operation_details', 'validate_flow', 'preflight_flow'], steps: ['Choose an existing FlowAgent template before authoring from scratch.', 'Discover each connector operation and real connection references.', 'Validate and preflight before creation; include error handling and correlation IDs.', 'Package the solution-aware flow, activate it, and verify successful and failed run histories.'] },
  'copilot-studio': { skill: 'dataverse:dv-solution', tools: ['pac copilot init', 'pac copilot clone', 'pac copilot pack', 'pac copilot publish'], steps: ['Discover installed PAC capabilities and use documented init/clone commands to author a real agent workspace; reuse Dataverse, Power Automate and other installed skills for tools and dependencies.', 'Document instructions, topics, knowledge citations, authentication, tool permissions, safety boundaries and the approved published channel.', 'Package the actual agent and dependencies in the named solution; configure platformIdentity, target mapping and a copilot-publish action.', 'Independently exercise grounding, fallback, tool actions, authorization, safety and multi-turn conversation on the published channel; retain transcripts, screenshots and recovery evidence.'] },
  deployment: { skill: 'dataverse:dv-solution', tools: [], steps: ['Export and unpack the actual solution into solution/.', 'Build the solution package with scripts/pack.mjs.', 'Add project-specific integration tests, verification and recovery rehearsal evidence.', 'Create an immutable release and request independent QA review.'] },
} as const;
export type TemplateId = keyof typeof recipes;
export const templateCatalog = () => Object.entries(recipes).map(([id, recipe]) => ({ id, version: 1, skill: recipe.skill, requiredTools: recipe.tools, validation: 'Locally tested scaffold and packaging contract; tenant validation required', tenantVerified: false }));

export function templateFiles(id: TemplateId) {
  if (!Object.hasOwn(recipes, id)) throw new HttpError(404, 'Unknown implementation template');
  const recipe = recipes[id];
  return {
    'recipe.json': JSON.stringify({ schemaVersion: 1, platform: id, version: 1, ...recipe }, null, 2),
    'README.md': `# ${id} implementation starter\n\nRead the installed ${recipe.skill} SKILL.md before authoring. This is a supported workflow scaffold, not a deployed or tenant-verified solution.\n\n${recipe.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\nKeep this bundle as a reference. Move and adapt scripts into your project deliberately. Build real components through their authoring tools; no fixture may satisfy a release gate.\n`,
    'docs/experience-brief.md': '# Experience brief\n\nRecord audience, primary tasks, brand, navigation, typography, spacing and colors. Define loading, empty, validation, failure, recovery and success states. Link each task to a release acceptance criterion and a browser assertion.\n',
    'docs/recovery.md': '# Data-preserving recovery\n\nRecord the installed version, prior release ID, export/archive locations, schema compatibility and connection settings. Rehearse the recovery procedure in an explicitly authorized separate environment. Verify protected records, ownership, relationships and attachments before and after restoration. Retain observed evidence and a SHA-256 hash of this runbook. Prefer a forward repair when an older package cannot preserve data. Do not automate destructive rollback.\n',
    'docs/platform-checks.md': `# ${id} checks\n\nRequired tool discovery: ${recipe.tools.join(', ') || 'PAC CLI solution commands'}.\n\nVerify current authentication, environment, licence and connector access before task assignment. Offline parsing is not platform compilation or tenant execution.\n`,
    'design-tokens.json': JSON.stringify({ color: { background: '#f8fafc', text: '#0f172a', primary: '#1d4ed8', error: '#b91c1c' }, spacing: [4, 8, 12, 16, 24, 32, 48], type: { bodyPx: 16, lineHeight: 1.5 }, focus: { widthPx: 3, color: '#1d4ed8' }, targetMinPx: 44 }, null, 2),
    'scripts/pack.mjs': `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const folder = path.resolve(process.argv[2] || 'solution');
const output = path.resolve(process.argv[3] || 'artifacts/solution.zip');
if (!fs.existsSync(path.join(folder, 'Other', 'Solution.xml'))) throw new Error('Export/unpack the real solution first; missing Other/Solution.xml');
fs.mkdirSync(path.dirname(output), { recursive: true });
const executable = process.env.SWARM_PAC_EXECUTABLE || 'pac';
const result = spawnSync(executable, ['solution', 'pack', '--folder', folder, '--zipfile', output], { stdio: 'inherit', shell: false, windowsHide: true });
if (result.error || result.status !== 0) throw result.error || new Error('PAC packaging failed');
if (!fs.statSync(output).size) throw new Error('Package is empty');
`,
    'contracts/verification-checklist.json': JSON.stringify({ requiredCategories: ['journey', 'authorization', 'persistence', 'error-handling'], requiredStates: ['loading', 'empty', 'validation', 'failure', 'recovery', 'success'], viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }], seriousAccessibilityViolations: 0, minVisualScore: 4, independentlyReviewed: false }, null, 2),
  };
}

/** Writes a fresh reference bundle only; never overwrites application source. */
export async function installTemplate(checkout: string, id: TemplateId) {
  const root = await fs.realpath(checkout); const files = templateFiles(id);
  const directory = await fs.mkdtemp(path.join(root, `swarm-starter-${id}-`));
  for (const [name, content] of Object.entries(files)) { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content, { flag: 'wx' }); }
  const hashes = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, crypto.createHash('sha256').update(content).digest('hex')]));
  await fs.writeFile(path.join(directory, 'template-lock.json'), JSON.stringify({ id, version: 1, hashes }, null, 2), { flag: 'wx' });
  return { directory, files: Object.keys(files), tenantVerified: false };
}
