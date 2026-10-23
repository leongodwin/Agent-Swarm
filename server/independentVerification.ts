import {verificationNavigationUrl,verificationScenario,type BrowserVerificationContext} from './browserVerificationContext.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import type { Browser, Page, Frame } from 'playwright';
import type { ReleasePlan } from './releasePlan.ts';
import AxeBuilder from '@axe-core/playwright';
import { acceptanceScope } from './releasePlan.ts';
import {verifyConnectedBrowser} from './bridgeVerification.ts';
import {coordinatorBrowserEnabled} from './browserTools.ts';
import {verifyHeadlessFlow} from './headlessFlowVerification.ts';
import {verifyCoordinatorBrowser} from './coordinatorBrowserVerification.ts';
const require = createRequire(import.meta.url);

/** No repository code executes here. The office interprets an immutable, QA-approved action plan. */
async function launchBrowser() {
  const playwright = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright') as typeof import('playwright');
  return playwright.chromium.launch({ channel: 'chrome', headless: true });
}
export async function verifyIndependently(plan: ReleasePlan, root: string, evidence: string, signal: AbortSignal, launch: () => Promise<Browser> = launchBrowser, execution?:BrowserVerificationContext) {
  if(plan.verification.headlessFlow){if(!execution?.assertOwned)throw Error('Headless verification requires a runner-owned lease/scope guard');return verifyHeadlessFlow(plan.verification.headlessFlow,plan.verification.baseUrl,evidence,signal,undefined,execution.assertOwned,path.join(os.homedir(),'.cubefarm','headless-dispatch-claims'),undefined,execution.acceptedHeadlessReport,execution.executionAdmission,plan.quality.maxTaskDurationMs,plan.deliveryRecord?.id);}
  if(plan.verification.browserSession)return coordinatorBrowserEnabled()?verifyCoordinatorBrowser(plan,root,evidence,signal,execution):verifyConnectedBrowser(plan,evidence,signal,undefined,execution);
  if (signal.aborted) throw new Error('Verification cancelled');
  const browser = await launch();
  const abort = () => { void browser.close(); }; signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const files: string[] = []; const results: unknown[] = [];
  try {
    for (const identity of plan.verification.identities) {
      const auth = path.join(root, 'delivery-identities', `${identity.id}.json`);
      await fs.access(auth).catch(() => { throw new Error(`QA identity ${identity.id} is not connected; capture its browser storage state in delivery-identities/${identity.id}.json`); });
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ storageState: auth, viewport });
        context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(30_000);
        const prefix = `independent-${identity.id}-${viewport.width}`;
        await context.tracing.start({ screenshots: true, snapshots: true });
        try {
          const page = await context.newPage(); const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(verificationNavigationUrl(plan,execution));
          if (new URL(page.url()).origin !== new URL(plan.verification.baseUrl).origin) throw new Error(`QA identity ${identity.id} was redirected away from the application`);
          const target = async (): Promise<Page | Frame> => {
            if (new URL(page.url()).origin !== new URL(plan.verification.baseUrl).origin) throw new Error('Test left the approved application origin');
            if (!plan.verification.frame) return page;
            const element = await page.locator(plan.verification.frame.selector).elementHandle();
            const frame = await element?.contentFrame();
            if (!frame || new URL(frame.url()).origin !== new URL(plan.verification.frame.origin).origin) throw new Error('Frame is not on the approved application origin');
            return frame;
          };
          await (await target()).locator(identity.userSelector).filter({ hasText: identity.expectedUser }).waitFor({ state: 'visible' });
          for (const [index, scenario] of plan.verification.scenarios.entries()) {
            if (scenario.identity !== identity.id) continue;
            const uploads: { name: string; sha256: string; evidence: string }[] = [];
            const started = Date.now();
            await execution?.scenarioStarted?.(scenario.name,viewport.width);
            signal.throwIfAborted();
            for (const step of verificationScenario(plan,execution,scenario).steps) {
              if (signal.aborted) throw new Error('Verification cancelled');
              if(Date.now()-started>=plan.quality.maxTaskDurationMs)throw Error('Usability time limit exceeded before browser action');
              const surface = await target();
              if (step.action === 'goto') await page.goto(new URL(step.path, plan.verification.baseUrl).href);
              if (step.action === 'click') await surface.locator(step.selector).click();
              if (step.action === 'fill') await surface.locator(step.selector).fill(step.value);
              if (step.action === 'reload') await page.reload();
              if (step.action === 'press') await surface.locator(step.selector).press(step.key);
              if (step.action === 'upload') {
                const base = await fs.realpath(path.join(root, 'delivery-fixtures'));
                const file = await fs.realpath(path.join(base, step.fixture));
                const relative = path.relative(base, file); const stat = await fs.stat(file);
                if (relative.startsWith('..') || path.isAbsolute(relative) || !stat.isFile() || stat.size === 0 || stat.size > 10 * 1024 * 1024) throw new Error('Upload fixture must be a nonempty file within delivery-fixtures, at most 10 MiB');
                const buffer = await fs.readFile(file); const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
                if (sha256 !== step.sha256) throw new Error('Upload fixture changed since QA approved the plan');
                const mime: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain' };
                await surface.locator(step.selector).setInputFiles({ name: step.fixture, mimeType: mime[path.extname(step.fixture)], buffer });
                const uploadEvidence = `${prefix}-${index}-${step.fixture}`; await fs.writeFile(path.join(evidence, uploadEvidence), buffer); files.push(uploadEvidence);
                uploads.push({ name: step.fixture, sha256, evidence: uploadEvidence });
              }
              if (step.action === 'text') {
                await surface.locator(step.selector).filter({ hasText: step.contains }).first().waitFor({ state: 'visible' });
              }
              await target();
            }
            const userLabel = (await target()).locator(identity.userSelector).filter({ hasText: identity.expectedUser });
            await userLabel.waitFor({ state: 'visible' });
            const observedUser = await userLabel.innerText();
            if (errors.length) throw new Error(`Browser error: ${errors[0]}`);
            const durationMs = Date.now() - started;
            if (durationMs > plan.quality.maxTaskDurationMs) throw new Error(`Usability time limit exceeded for ${scenario.name}: ${durationMs}ms`);
            const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            const a11yFile = `${prefix}-${index}-accessibility.json`;
            await fs.writeFile(path.join(evidence, a11yFile), JSON.stringify(accessibility, null, 2)); files.push(a11yFile);
            if (accessibility.violations.some((v) => ['serious', 'critical'].includes(v.impact ?? ''))) throw new Error(`Accessibility gate failed for ${scenario.name}; see ${a11yFile}`);
            if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) || await (await target()).evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`Horizontal overflow at ${viewport.width}px in ${scenario.name}`);
            const file = `${prefix}-${index}.png`; await page.screenshot({ path: path.join(evidence, file), fullPage: true }); files.push(file);
            await execution?.scenarioCompleted?.(scenario.name,viewport.width);
            results.push({ name: scenario.name, category: scenario.category, criterion: scenario.criterion, states: scenario.states, durationMs, accessibility: a11yFile, identity: identity.id, expectedUser: identity.expectedUser, observedUser, method: plan.verification.frame ? 'browser-frame' : 'browser-dom', uploads, viewport, passed: true, screenshot: file });
          }
        } finally {
          const trace = `${prefix}.zip`; try { await context.tracing.stop({ path: path.join(evidence, trace) }); files.push(trace); } finally { await context.close(); }
        }
      }
    }
    await fs.writeFile(path.join(evidence, 'independent-verification.json'), JSON.stringify({ schemaVersion: 1, acceptance: acceptanceScope(plan), applicationUrl: plan.verification.baseUrl, completedAt: new Date().toISOString(), results }, null, 2));
    return ['independent-verification.json', ...files];
  } catch (error) {
    await fs.writeFile(path.join(evidence, 'independent-failure.json'), JSON.stringify({ failedAt: new Date().toISOString(), error: String((error as Error).message), completedScenarios: results }, null, 2));
    throw error;
  } finally { signal.removeEventListener('abort', abort); await browser.close(); }
}
