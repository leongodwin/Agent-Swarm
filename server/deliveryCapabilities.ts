import path from 'node:path';
import { discoverSkills, selectSkills } from './skillRegistry.ts';

/** Refresh metadata at dispatch; only relevant references enter the prompt. */
export function deliveryCapabilitiesPrompt(task = '') {
  const catalogue = discoverSkills();
  const selected = selectSkills(catalogue, task);
  const guide = path.resolve(import.meta.dirname, '..', 'docs', 'DELIVERY.md');
  return [`Office delivery reference: ${guide}`,
    `Both Codex and office agents can use installed Power Platform skills. Catalogue fingerprint: ${catalogue.fingerprint}.`,
    `Installed platforms: ${[...new Set(catalogue.skills.map((skill) => skill.platform))].join(', ') || 'none discovered'}.`,
    'Use installed_skills to discover task-specific workflows. Read applicable SKILL.md instructions before authoring. Verify actual MCP/CLI tools, active plugin version, caller and target inside this worker session; installation alone is not readiness.',
    'Record selected skill IDs, versions/content hashes and verified tools in task evidence. Reuse discovery only while target, authentication and configuration remain unchanged. Missing Copilot Studio lifecycle tools are a blocker; code-app Copilot integration is not a lifecycle adapter.',
    ...selected.map((skill) => `${skill.id} (${skill.version ?? 'shared'}, sha256 ${skill.sha256}): ${skill.file}`), ...catalogue.warnings].join('\n');
}
