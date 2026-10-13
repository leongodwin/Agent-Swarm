import fs from 'node:fs/promises';
import { z } from 'zod';

const record = z.record(z.string(), z.unknown());
const identified = record.refine(value => typeof value.id === 'string' && value.id.length > 0, 'Missing persisted identity');
const log = z.object({id: z.number().int().nonnegative(), t: z.number().finite(), kind: z.enum(['text', 'tool', 'result', 'system', 'error', 'manager', 'done', 'thinking']), text: z.string()}).passthrough();
const repository = identified.and(z.object({
  fullName: z.string().min(1), defaultBranch: z.string().min(1),
  links: z.array(z.string()).optional(), localPath: z.string().nullable().optional(),
  preview: z.object({command: z.string().nullable().optional(), env: z.record(z.string(), z.string()).optional()}).passthrough().optional(),
}).passthrough());
const agent = identified.and(z.object({
  name: z.string().min(1), repoId: z.string(),
  status: z.enum(['idle', 'preparing', 'working', 'done', 'error', 'stopped']),
  role: z.enum(['dev', 'qa', 'ceo']).optional(), task: z.enum(['issue', 'qa', 'fix']).nullable().optional(),
  sessionId: z.string().nullable().optional(), branch: z.string().nullable().optional(), logTail: z.array(log).optional(),
}).passthrough());
const schema = z.object({
  version: z.number().int().min(0).max(2).optional(),
  settings: record.optional(),
  repos: z.array(repository).optional(),
  agents: z.array(agent).optional(),
  qa: z.array(record).optional(),
  requests: z.array(record).optional(),
  messages: z.array(record).optional(),
  ceo: z.object({queue: z.array(record).optional(), job: record.nullable().optional()}).passthrough().optional(),
  phoneReadAt: z.number().finite().nonnegative().optional(),
}).passthrough();

/** Only a missing file is a first run. Never overwrite unreadable or newer office state. */
export async function readOfficeState(file: string): Promise<z.infer<typeof schema> | null> {
  let found = false;
  try {
    const stat = await fs.stat(file);
    found = true;
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid or oversized state file');
    const raw = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error('State grew beyond the size limit');
    const value = schema.parse(JSON.parse(raw));
    for (const entries of [value.repos, value.agents]) {
      const ids = entries?.map(entry => entry.id) ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('Duplicate persisted identities');
    }
    return value;
  } catch (error) {
    if (!found && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot load office state at ${file}; preserve and repair it before restarting`, {cause: error});
  }
}
