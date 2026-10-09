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
    const fromNull = parseSolutionFolder(null, true);
    expect(fromNull.isUnpacked).toBe(false);
    expect(fromNull.components.copilot_engine).toBeDefined();
    expect(fromNull.totalComponents).toBe(Object.keys(FALLBACK_SOLUTION_NODES).length);

    const fromMissing = parseSolutionFolder(path.join(os.tmpdir(), 'non-existent-solution-dir-' + Date.now()), true);
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

    fs.writeFileSync(path.join(botDir, 'ChecklistTopic.yaml'), 'kind: AdaptiveDialog\nname: Checklist\n');
    fs.writeFileSync(path.join(flowDir, 'DispatchSupervisor.json'), '{"definition":{"actions":{},"triggers":{}}}');
    fs.writeFileSync(path.join(entityDir, 'entity.xml'), '<entity name="cr_equipment"></entity>');

    const parsed = parseSolutionFolder(tmp);
    expect(parsed.isUnpacked).toBe(true);
    const topic = parsed.components['topic_BotComponents%2FChecklistTopic.yaml'];
    expect(topic.category).toBe('2. Copilot Studio');
    expect(topic.sourceFile).toContain('ChecklistTopic.yaml');

    const flow = parsed.components['flow_Workflows%2FDispatchSupervisor.json'];
    expect(flow.category).toBe('3. Automation & Logic');
    expect(flow.sourceFile).toContain('DispatchSupervisor.json');

    const entity = parsed.components['entity_Entities%2Fcr_equipment%2Fentity.xml'];
    expect(entity.category).toBe('4. Dataverse & Storage');
    expect(entity.sourceFile).toContain('entity.xml');
    expect(parsed.totalComponents).toBe(3);
    expect(parsed.components.copilot_engine).toBeUndefined();
    expect(topic.telemetry.successRate).toBe('—');
  });
  it('returns an unavailable real checkout without fictional components', () => {
    expect(parseSolutionFolder(null).components).toEqual({});
    expect(parseSolutionFolder(null).simulated).toBe(false);
  });
  it('keeps same-named topics distinct, detects PCF, and ignores arbitrary YAML', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-topics-'));
    tempDirs.push(tmp);
    for (const solution of ['one', 'two']) {
      const dir = path.join(tmp, solution, 'Topics'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Greeting.yaml'), 'kind: AdaptiveDialog\n');
    }
    fs.writeFileSync(path.join(tmp, 'ci.yaml'), 'kind: AdaptiveDialog\n');
    fs.writeFileSync(path.join(tmp, 'ControlManifest.Input.xml'), '<manifest><control namespace="Test" constructor="Grid" /></manifest>');
    const result = parseSolutionFolder(tmp);
    expect(result.totalComponents).toBe(3);
    expect(Object.values(result.components).filter((node) => node.id.startsWith('topic_'))).toHaveLength(2);
    expect(Object.values(result.components).some((node) => node.id.startsWith('pcf_'))).toBe(true);
  });
});
