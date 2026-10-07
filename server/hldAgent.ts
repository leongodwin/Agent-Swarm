import fs from 'node:fs';
import path from 'node:path';
import { generateHldContent, type HldInput, type HldResult } from '../shared/hld.ts';

export * from '../shared/hld.ts';

export function generateHld(input: HldInput): HldResult {
  const result = generateHldContent(input);

  if (input.repoPath) {
    try {
      const archDir = path.join(input.repoPath, 'docs', 'architecture');
      fs.mkdirSync(archDir, { recursive: true });
      const filePath = path.join(archDir, 'HLD.md');
      fs.writeFileSync(filePath, result.markdownContent, 'utf-8');
      result.savedFilePath = filePath;
    } catch {
      // Ignored in test/demo mode
    }
  }

  return result;
}
