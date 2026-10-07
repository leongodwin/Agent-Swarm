import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { parseSolutionFolder, FALLBACK_SOLUTION_NODES } from '../shared/solutionParser.ts';

describe('Solution Parser', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0;
  });

  it('returns simulated fallback architecture when path is null or non-existent', () => {
    const fromNull = parseSolutionFolder(null);
    expect(fromNull.isUnpacked).toBe(false);
    expect(fromNull.components.copilot_engine).toBeDefined();
    expect(fromNull.totalComponents).toBe(Object.keys(FALLBACK_SOLUTION_NODES).length);

    const fromMissing = parseSolutionFolder(path.join(os.tmpdir(), 'non-existent-solution-dir-' + Date.now()));
    expect(fromMissing.isUnpacked).toBe(false);
    expect(fromMissing.components.teams).toBeDefined();
  });

  it('scans and parses unpacked solution artifacts: topics, flows, and entities', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-solution-test-'));
    tempDirs.push(tmp);

    // Create unpacked structure
    const botDir = path.join(tmp, 'BotComponents');
    const flowDir = path.join(tmp, 'Workflows');
    const entityDir = path.join(tmp, 'Entities', 'cr_equipment');

    fs.mkdirSync(botDir, { recursive: true });
    fs.mkdirSync(flowDir, { recursive: true });
    fs.mkdirSync(entityDir, { recursive: true });

    fs.writeFileSync(path.join(botDir, 'ChecklistTopic.yaml'), 'name: Checklist\nversion: 1.0\n');
    fs.writeFileSync(path.join(flowDir, 'DispatchSupervisor.json'), '{"name": "DispatchSupervisor"}');
    fs.writeFileSync(path.join(entityDir, 'entity.xml'), '<entity name="cr_equipment"></entity>');

    const parsed = parseSolutionFolder(tmp);
    expect(parsed.isUnpacked).toBe(true);
    expect(parsed.components.topic_ChecklistTopic).toBeDefined();
    expect(parsed.components.topic_ChecklistTopic.category).toBe('2. Copilot Studio');
    expect(parsed.components.topic_ChecklistTopic.sourceFile).toContain('ChecklistTopic.yaml');

    expect(parsed.components.flow_DispatchSupervisor).toBeDefined();
    expect(parsed.components.flow_DispatchSupervisor.category).toBe('3. Automation & Logic');
    expect(parsed.components.flow_DispatchSupervisor.sourceFile).toContain('DispatchSupervisor.json');

    expect(parsed.components.entity_cr_equipment).toBeDefined();
    expect(parsed.components.entity_cr_equipment.category).toBe('4. Dataverse & Storage');
    expect(parsed.components.entity_cr_equipment.sourceFile).toContain('entity.xml');
  });
});
