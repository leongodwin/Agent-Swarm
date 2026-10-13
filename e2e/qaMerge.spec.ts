import {test, expect} from '@playwright/test';
import type {QaView, PullInfo, WorldSnapshot} from '../shared/types';

// Rendered client-contract test with explicitly synthetic WebSocket data.
// Real Swarm QA/merge transitions are exercised separately in swarmLifecycle.test.ts.
test('Kanban requires current commit approval and offers no QA bypass', async ({page, request}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await request.get('/api/session');
  const snapshot = await (await request.get('/api/state')).json() as WorldSnapshot;
  const repo = snapshot.repos[0];
  const pull = (number: number, title: string): PullInfo => ({number, title, url: '', headRefName: `swarm/test-${number}`, headSha: `head-${number}`, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', checks: 'passing', failedChecks: [], pendingChecks: [], closesIssues: [], createdAt: '', mergedAt: null, additions: 1, deletions: 0, reviewDecision: null});
  const qa = (prNumber: number, status: QaView['status'], passedSha: string | null): QaView => ({repoId: repo.id, prNumber, status, passedSha, testedSha: passedSha, round: 1, devAgentId: null, qaAgentId: null, summary: 'Synthetic UI fixture', checks: [], commentUrl: null, mergeNote: null, updatedAt: Date.now()});
  snapshot.repos = [{...repo, autoAssign: false, autoMerge: false, issues: [], pulls: [pull(91, 'Synthetic failed QA'), pull(92, 'Synthetic legacy approval'), pull(93, 'Synthetic current approval'), pull(94, 'Synthetic stale approval')]}];
  snapshot.qa = [qa(91, 'needs-human', null), qa(92, 'passed', null), qa(93, 'passed', 'head-93'), qa(94, 'passed', 'old-head-94')];
  snapshot.settings.setupDone = true;
  snapshot.settings.tutorialStep = -1;
  await page.routeWebSocket('/ws', ws => ws.send(JSON.stringify({type: 'snapshot', data: snapshot})));
  await page.addInitScript(floor => localStorage.setItem('cubefarm:view', JSON.stringify({floor, x: 0, z: -9.4, yaw: 0, pitch: 0.04})), repo.floor);
  await page.goto('/');
  await page.getByRole('button', {name: 'Enter the office', exact: true}).click();
  await expect(page.getByText('Open the Kanban board')).toBeVisible();
  await expect(page.getByText(/3 in QA · 1 QA approved/)).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByRole('button', {name: 'Merge anyway', exact: true})).toHaveCount(0);
  await expect(page.getByText('QA approval needs refresh for this commit', {exact: true})).toHaveCount(2);
  await expect(page.getByRole('button', {name: 'Retry QA', exact: true})).toHaveCount(3);
  const merge = page.getByRole('button', {name: 'Merge', exact: true});
  await expect(merge).toHaveCount(1); await expect(merge).toBeEnabled(); await merge.click();
  await expect(page.getByText(/passed QA for commit head-93/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Verify & merge', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.screenshot({path: '.swarm-reliability/qa-merge-ui-2026-10-13.png', fullPage: true});
});
