import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from './atomicFile.ts';
import { HttpError } from './httpError.ts';
import type { TenantDlpView } from '../shared/tenantDlp.ts';

const identitySchema = z.object({ tenantId: z.uuid(), caller: z.email().max(254) }).strict();
export const tenantSnapshotSchema = identitySchema.extend({ schemaVersion: z.literal(1), observedAt: z.iso.datetime(), source: z.literal('Get-DlpPolicy module route'), moduleVersion: z.literal('2.0.219'), scope: z.literal('standard-policy-inventory'), complete: z.literal(true), pages: z.number().int().min(1).max(100), policies: z.array(z.record(z.string(), z.unknown())).max(5000) }).strict();
type Snapshot = z.infer<typeof tenantSnapshotSchema>;
type Identity = z.infer<typeof identitySchema>;
const ttl = 15 * 60_000;
export function verifyTenantSnapshot(input: unknown, identity: Identity, now = Date.now()): Snapshot {
  const value = tenantSnapshotSchema.parse(input);
  if (value.tenantId.toLowerCase() !== identity.tenantId.toLowerCase() || value.caller.toLowerCase() !== identity.caller.toLowerCase()) throw new Error('Policy inventory identity differs from the requested target');
  const age = now - Date.parse(value.observedAt);
  if (age < -30_000 || age > ttl) throw new Error('Policy inventory is stale or dated in the future');
  // Unknown policy structures are preserved for later evaluators, never interpreted as compliant.
  return value;
}
export interface PolicyReader {
  pid?: number;
  refresh(): void;
  stop(): void;
}
export type StartPolicyReader = (identity: Identity, result: (value: unknown) => void, ended: () => void) => PolicyReader;
const startReader: StartPolicyReader = (identity, result, ended) => {
  if (process.platform !== 'win32') throw new Error('This policy reader requires Windows PowerShell 5');
  const child: ChildProcessWithoutNullStreams = spawn('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('./tenantDlpReader.ps1', import.meta.url)), '-TenantId', identity.tenantId, '-ExpectedUser', identity.caller], { windowsHide: true, stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  let bytes = 0;
  child.stdout.on('data', (buffer: Buffer) => { bytes += buffer.length; if (bytes > 8 * 1024 * 1024) child.kill(); });
  child.stderr.on('data', () => {}); // drain without retaining tokens or raw provider diagnostics
  lines.on('line', (line) => {
    if (!line.startsWith('SWARM_DLP ')) return;
    bytes = 0;
    try { result(JSON.parse(line.slice(10))); } catch { result(null); }
  });
  let stopped = false;
  const finish = () => { if (!stopped) { stopped = true; lines.close(); ended(); } };
  child.stdin.on('error', finish);
  child.once('error', finish); child.once('close', finish);
  return { pid: child.pid, refresh() { child.stdin.write('refresh\n'); }, stop() { child.stdin.end('close\n'); child.kill(); } };
};

/** A user-triggered read-only reader. A warm process reuses native MSAL authentication;
 * requests cannot supply policies or tokens, and failed refreshes never become an empty passing inventory. */
export class TenantDlpService {
  private snapshot?: Snapshot;
  private reason = 'No authenticated standard DLP inventory has been observed';
  private reader?: PolicyReader;
  private identity?: Identity;
  private pending?: { timer: NodeJS.Timeout };
  private reading = false;
  private unavailable = true;
  private closed = false;
  private corrupt = false;
  private saving: Promise<void> = Promise.resolve();
  constructor(private home: string, private start: StartPolicyReader = startReader, private now: () => number = Date.now) {}
  async init() {
    try { const file = path.join(this.home, 'tenant-dlp.json'); if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('oversized'); this.snapshot = tenantSnapshotSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))); this.unavailable = false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.corrupt = true; this.reason = 'Saved policy evidence is unreadable; preserve it before repair'; } }
  }
  view(): TenantDlpView {
    const stale = this.snapshot && (this.now() - Date.parse(this.snapshot.observedAt) > ttl || Date.parse(this.snapshot.observedAt) > this.now() + 30_000);
    return { status: this.reading ? 'reading' : this.unavailable ? 'unavailable' : stale ? 'stale' : 'observed', scope: 'standard-policy-inventory', complianceVerified: false,
      ...(this.reader?.pid ? {readerPid:this.reader.pid} : {}),
      ...(this.snapshot ? { tenantId: this.snapshot.tenantId, caller: this.snapshot.caller, observedAt: this.snapshot.observedAt, policyCount: this.snapshot.policies.length, fingerprint: crypto.createHash('sha256').update(JSON.stringify(this.snapshot)).digest('hex') } : {}),
      reason: this.reading ? 'Complete the system-browser sign-in if requested; the reader makes no tenant changes' : this.unavailable ? this.reason : stale ? 'Refresh the expired policy observation before using it' : 'Inventory observed; policy evaluation, advanced governance and schema evidence remain separate' };
  }
  observation(identity:{tenantId:string;caller:string}) {
    if(this.closed||this.view().status!=='observed'||!this.snapshot) throw new Error('A fresh authenticated standard-policy inventory is required');
    return structuredClone(verifyTenantSnapshot(this.snapshot,identity,this.now()));
  }
  refresh(input: unknown): TenantDlpView {
    if (this.closed) throw new HttpError(409, 'Policy reader is closed');
    if (this.corrupt) throw new HttpError(409, 'Preserve and repair the corrupted policy evidence before refreshing');
    let identity = identitySchema.parse(input);
    if (this.pending) throw new HttpError(409, 'A policy discovery request is already pending');
    if (this.identity && (identity.tenantId.toLowerCase() !== this.identity.tenantId.toLowerCase() || identity.caller.toLowerCase() !== this.identity.caller.toLowerCase())) { const old = this.reader; this.reader = undefined; old?.stop(); this.snapshot = undefined; this.unavailable = true; }
    else if (this.identity) identity = this.identity;
    this.identity = identity;
    this.reading = true;
    const timer = setTimeout(() => { this.fail('Policy discovery expired; retry interactively'); const old = this.reader; this.reader = undefined; old?.stop(); }, 10 * 60_000); timer.unref();
    this.pending = { timer };
    try {
      if (this.reader) this.reader.refresh();
      else {
        const reader = this.start(identity, (value) => { this.saving = this.saving.then(() => this.observe(value, identity)); }, () => { if (this.reader === reader) { this.reader = undefined; if (this.pending) this.fail('Policy reader stopped before completing discovery'); } });
        this.reader = reader;
      }
    } catch { this.fail('Policy reader could not start; install the supported administration module and Windows PowerShell'); }
    return this.view();
  }
  private fail(reason: string) { clearTimeout(this.pending?.timer); this.pending = undefined; this.reading = false; this.unavailable = true; this.reason = reason; }
  private async observe(value: unknown, identity: Identity) {
    if (!this.pending || this.closed || this.identity !== identity) return;
    const pending = this.pending;
    try {
      const response = z.object({ status: z.literal('observed'), snapshot: z.unknown() }).strict().parse(value);
      const snapshot = verifyTenantSnapshot(response.snapshot, identity, this.now());
      await atomicWrite(path.join(this.home, 'tenant-dlp.json'), JSON.stringify(snapshot, null, 2));
      if (this.closed || this.identity !== identity || this.pending !== pending) return;
      this.snapshot = snapshot; this.unavailable = false; this.reading = false; clearTimeout(this.pending?.timer); this.pending = undefined;
    } catch { this.fail('Policy discovery or evidence persistence failed; previous evidence is not current verification'); }
  }
  async settled() { await this.saving; }
  async close() { this.closed = true; clearTimeout(this.pending?.timer); this.pending = undefined; this.reading = false; const old = this.reader; this.reader = undefined; old?.stop(); await this.saving; }
}
