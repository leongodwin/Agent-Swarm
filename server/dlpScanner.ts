/**
 * Solution Directory DLP Scanner
 * Audits checked-out solution folders for Power Platform & Entra ID policy compliance:
 * - Scans Workflows/*.json for blocked connectors or anonymous endpoints
 * - Scans BotComponents/*.yaml for prohibited external integrations
 * - Scans Entities/*.xml and other solution components
 */

import fs from 'node:fs';
import path from 'node:path';
import { auditDlpCompliance, type DlpPolicyViolation } from '../shared/dlp.ts';

export interface DlpScanReport {
  repoFullName: string;
  checkoutPath: string | null;
  scannedFiles: number;
  scannedPaths: string[];
  violations: DlpPolicyViolation[];
  timestamp: string;
  isRealScan: boolean;
}

export function scanDirectoryDlp(dir: string | null, repoFullName: string): DlpScanReport {
  const violations: DlpPolicyViolation[] = [];
  const scannedPaths: string[] = [];

  if (!dir || !fs.existsSync(dir)) {
    return {
      repoFullName,
      checkoutPath: dir,
      scannedFiles: 0,
      scannedPaths: [],
      violations: [],
      timestamp: new Date().toLocaleTimeString(),
      isRealScan: false,
    };
  }

  const walk = (currentDir: string, depth = 0) => {
    if (depth > 6) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      const full = path.join(currentDir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        // Check unpacked solution files and logic definitions
        if (
          lower.endsWith('.json') ||
          lower.endsWith('.yaml') ||
          lower.endsWith('.yml') ||
          lower.endsWith('.xml') ||
          lower.endsWith('.botproj') ||
          lower.endsWith('.js') ||
          lower.endsWith('.ts')
        ) {
          const relPath = path.relative(dir, full).replace(/\\/g, '/');
          scannedPaths.push(relPath);
          try {
            const content = fs.readFileSync(full, 'utf8');
            const v = auditDlpCompliance(content, relPath);
            violations.push(...v);
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }
  };

  walk(dir);

  return {
    repoFullName,
    checkoutPath: dir,
    scannedFiles: scannedPaths.length,
    scannedPaths: scannedPaths.slice(0, 50),
    violations,
    timestamp: new Date().toLocaleTimeString(),
    isRealScan: scannedPaths.length > 0,
  };
}
