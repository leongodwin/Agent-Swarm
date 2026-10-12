import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
/** Installed and pinned with the office, so each agent avoids an npx download/startup race. */
export function playwrightMcp(outputDir?: string) {
  const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  return { command: process.execPath, args: [cli, '--headless', '--isolated',
    ...(outputDir ? ['--output-dir', outputDir] : []), '--init-script', path.join(import.meta.dirname, 'browser-init.js')] };
}
