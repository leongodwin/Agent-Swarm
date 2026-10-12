import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { afterEach, expect, it } from 'vitest';
import { verifyIndependently } from './independentVerification.ts';
import { releasePlanSchema } from './releasePlan.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture(accessible = true, framed = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-independent-')); roots.push(root);
  const evidence = path.join(root, 'evidence'); await fs.mkdir(evidence);
  await fs.mkdir(path.join(root, 'delivery-identities'));
  for (const id of ['employee', 'manager']) await fs.writeFile(path.join(root, 'delivery-identities', `${id}.json`), JSON.stringify({ cookies: [], origins: [{ origin: 'https://verification.test', localStorage: [{ name: 'user', value: id }] }] }));
  const plan = releasePlanSchema.parse({ name: 'Browser contract', owner: 'author', qaOwner: 'reviewer', requiredIssues: [1], components: ['app'], acceptanceCriteria: ['Write survives reload; restricted operation denied; invalid input rejected'], quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['flow'] }, verification: {
    baseUrl: 'https://verification.test', identities: ['employee', 'manager'].map((id) => ({ id, expectedUser: id, userSelector: '#user' })),
    scenarios: [
      { name: 'Loading', states: ['loading'], category: 'journey', identity: 'employee', criterion: 0, steps: [{ action: 'text', selector: '#loading', contains: 'Loading state' }] },
      { name: 'Empty', states: ['empty'], category: 'journey', identity: 'manager', criterion: 0, steps: [{ action: 'text', selector: '#empty', contains: 'No records' }] },
      { name: 'Save', states: ['success'], category: 'journey', identity: 'employee', criterion: 0, steps: [{ action: 'press', selector: '#input', key: 'Tab' }, { action: 'fill', selector: '#input', value: 'Saved expense' }, { action: 'click', selector: '#save' }, { action: 'text', selector: '#result', contains: 'Saved expense' }] },
      { name: 'Reload', states: ['recovery'], category: 'persistence', identity: 'employee', criterion: 0, steps: [{ action: 'reload' }, { action: 'text', selector: '#result', contains: 'Saved expense' }] },
      { name: 'Deny', states: ['failure'], category: 'authorization', identity: 'employee', criterion: 0, steps: [{ action: 'click', selector: '#admin' }, { action: 'text', selector: '#result', contains: 'Denied' }] },
      { name: 'Invalid', states: ['validation'], category: 'error-handling', identity: 'manager', criterion: 0, steps: [{ action: 'click', selector: '#save' }, { action: 'text', selector: '#result', contains: 'Required' }] },
    ],
  } });
  if (framed) plan.verification.frame = { selector: 'iframe[title="Expenses"]', origin: 'https://verification.test' };
  const launch = async () => {
    const browser = await chromium.launch({ headless: true });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext(options);
      await context.route('https://verification.test/**', (route) => route.fulfill({ contentType: 'text/html', body: framed && new URL(route.request().url()).pathname === '/' ? '<!doctype html><html lang="en"><head><title>Application host</title></head><body><main><h1>Application</h1><iframe title="Expenses" src="/canvas" style="width:100%;height:600px;border:0"></iframe></main></body></html>' : `<!doctype html><html lang="en"><head><title>Verification fixture</title></head><body><main><h1>Expenses</h1><div id="loading">Loading state</div><div id="empty">No records</div><div id="user"></div>${accessible ? '<label for="input">Expense</label>' : ''}<input id="input"><label for="receipt">Receipt</label><input id="receipt" type="file"><div id="receipt-result"></div><button id="save">Save</button><button id="admin">Admin</button><div id="result"></div><script>
      document.querySelector('#user').textContent = localStorage.getItem('user');
      const result = document.querySelector('#result');
      result.textContent = localStorage.getItem('value') || '';
      document.querySelector('#save').onclick = () => { const value = document.querySelector('#input').value; if (value) localStorage.setItem('value', value); result.textContent = value || 'Required'; };
      document.querySelector('#admin').onclick = () => { result.textContent = localStorage.getItem('user') === 'employee' ? 'Denied' : 'Allowed'; };
      document.querySelector('#receipt').onchange = () => { document.querySelector('#receipt-result').textContent = document.querySelector('#receipt').files[0]?.name || 'Missing'; };
      </script></main></body></html>` }));
      return context;
    };
    return browser;
  };
  return { root, evidence, plan, launch };
}

it('executes actual browser writes, reload, denied access and validation for two identities and widths', async () => {
  const { root, evidence, plan, launch } = await fixture();
  const files = await verifyIndependently(plan, root, evidence, new AbortController().signal, launch);
  const report = JSON.parse(await fs.readFile(path.join(evidence, 'independent-verification.json'), 'utf8'));
  expect(report.results).toHaveLength(12);
  expect(new Set(report.results.map((r: { identity: string }) => r.identity))).toEqual(new Set(['employee', 'manager']));
  expect(files.filter((f) => f.endsWith('.zip'))).toHaveLength(4);
  for (const file of files) expect((await fs.stat(path.join(evidence, file))).size).toBeGreaterThan(0);
}, 30_000);

it('refuses missing authentication state rather than treating a report as a pass', async () => {
  const { root, evidence, plan, launch } = await fixture();
  await fs.unlink(path.join(root, 'delivery-identities', 'employee.json'));
  await expect(verifyIndependently(plan, root, evidence, new AbortController().signal, launch)).rejects.toThrow('not connected');
});

it('runs framed journeys and an actual file-input upload with pinned receipt bytes', async () => {
  const { root, evidence, plan, launch } = await fixture(true, true);
  const bytes = Buffer.from('Synthetic receipt GBP 1.00'); const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(path.join(root, 'delivery-fixtures')); await fs.writeFile(path.join(root, 'delivery-fixtures', 'receipt.txt'), bytes);
  plan.verification.scenarios[0].steps.push({ action: 'upload', selector: '#receipt', fixture: 'receipt.txt', sha256 }, { action: 'text', selector: '#receipt-result', contains: 'receipt.txt' });
  await verifyIndependently(plan, root, evidence, new AbortController().signal, launch);
  const report = JSON.parse(await fs.readFile(path.join(evidence, 'independent-verification.json'), 'utf8'));
  expect(report.results.every((r: { method: string }) => r.method === 'browser-frame')).toBe(true);
  expect(report.results[0].uploads[0]).toMatchObject({ name: 'receipt.txt', sha256 });
  expect(await fs.readFile(path.join(evidence, report.results[0].uploads[0].evidence))).toEqual(bytes);
}, 30000);

it('refuses frames outside the approved origin and changed upload fixtures', async () => {
  const { root, evidence, plan, launch } = await fixture(true, true);
  plan.verification.frame!.origin = 'https://another.test';
  await expect(verifyIndependently(plan, root, evidence, new AbortController().signal, launch)).rejects.toThrow('Frame is not on the approved');
  plan.verification.frame!.origin = 'https://verification.test';
  await fs.mkdir(path.join(root, 'delivery-fixtures')); await fs.writeFile(path.join(root, 'delivery-fixtures', 'receipt.txt'), 'Changed receipt');
  plan.verification.scenarios[0].steps.push({ action: 'upload', selector: '#receipt', fixture: 'receipt.txt', sha256: '0'.repeat(64) });
  await expect(verifyIndependently(plan, root, evidence, new AbortController().signal, launch)).rejects.toThrow('Upload fixture changed');
}, 30000);

it('rejects uncovered acceptance criteria, self-approval and escaping navigation', async () => {
  const { plan } = await fixture();
  expect(releasePlanSchema.safeParse({ ...plan, acceptanceCriteria: [...plan.acceptanceCriteria, 'Untested'] }).success).toBe(false);
  expect(releasePlanSchema.safeParse({ ...plan, qaOwner: plan.owner }).success).toBe(false);
  plan.verification.scenarios[0].steps.unshift({ action: 'goto', path: '//other.test' });
  expect(releasePlanSchema.safeParse(plan).success).toBe(false);
});


it('blocks serious accessibility failures with central diagnostic evidence', async () => {
  const { root, evidence, plan, launch } = await fixture(false);
  await expect(verifyIndependently(plan, root, evidence, new AbortController().signal, launch)).rejects.toThrow('Accessibility gate');
  expect(await fs.readFile(path.join(evidence, 'independent-failure.json'), 'utf8')).toContain('Accessibility gate');
  const files = await fs.readdir(evidence); expect(files.some((f) => f.endsWith('-accessibility.json'))).toBe(true);
}, 30000);
