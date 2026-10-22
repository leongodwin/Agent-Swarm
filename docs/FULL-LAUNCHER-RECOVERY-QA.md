# Full launcher recovery and forced-crash adoption

15 October 2026. Existing changes, the protected Gemini installation and the running office were preserved. All live work used new temporary homes and copied checkouts. No tenant or connected repository was changed.

Follow-up: [Delivery lease and resumption QA](DELIVERY-LEASE-RESUMPTION-QA.md) records the subsequent reconciliation and durable hold implementation. The results below remain the earlier checkpoint.

## Implemented

- The owning launcher now replaces an unexpectedly failed server in both built and development modes. Recovery is limited to three starts per five minutes; another crash stops the launcher. Shutdown and update cancel pending recovery, and stale or foreign child exits cannot start another server.
- Native root-session identities are durably written to Swarm state before Gemini startup is acknowledged. Concurrent startup hooks share that checkpoint; rejection or cancellation withholds execution. Subagent and invalid identities cannot promote root readiness.
- Authenticated runtime diagnostics expose the actual parent, keeper instance and native process IDs so verification can bind physical ownership.
- Gemini paste submission waits for its rendered input and then passes the native input guard. The installed 0.64 contract converts an Enter processed within 30ms of a paste into a newline and has a separate 40ms unsafe-paste guard. A fixed delay between parent writes did not guarantee child processing order. Submission now times out without replay and stops when ownership/readiness changes.

## Authenticated forced-crash result: blocked

The real copied `scripts/office.mjs` launched the unmodified production `bin/cubefarm.js` and built server, in non-demo mode. An acknowledged HTTP reload preserved maintenance. The real authenticated Gemini task reached its native transcript, and the session ID was already on disk before the server was forcibly killed. Only the server PID was killed, never its process tree.

| Observation | Evidence |
| --- | --- |
| Owning launcher | PID 5832 |
| Initial server / acknowledged reload | 63816 / 67704 |
| Forced-crash replacement | 36600, same launcher and temporary home |
| Keeper | PID 65096, instance c279ebd7-2bcc-4bd8-8cee-b4d11ceafaa8 unchanged |
| Native Gemini at crash | PID 34036; session 12441d7a-1866-4b89-bd2a-44c96104913f |
| Replacement delivery state | Unavailable: interrupted deployment lease requires reconciliation |
| Task adoption | Blocked by CEO readiness; no successful adopted completion claimed |
| Cleanup | Verified isolated keeper/native shutdown and launcher exit |

This is a genuine production integration blocker, not a passing adoption result. Delivery leases deliberately survive a killed server: a dead PID cannot prove a previously dispatched cloud operation stopped. CEO readiness correctly refuses to bypass unavailable delivery. Independent QA confirmed that automatically removing the lease or skipping readiness would weaken existing protection.

The failed report's top-level error is the bounded observation timeout. The specific delivery-readiness refusal was independently read from the preserved fixture's `home/state.json`, CEO `lastError`, under `cubefarm-launcher-live-NtqazD`. These observations describe that terminated disposable run; they do not describe the current running office.

The first live attempt exposed the Gemini paste stall before reaching a provider task. That report is retained. The second attempt exercised the corrected initial-paste path; subsequent ownership and stale/malformed-marker hardening was independently tested locally. The artifact contains hashes of the actual copied production entry points. It does not certify every final source byte live.

## Full updater and explicit recovery: passed separately

A separate **no-native-task** run used the same real launcher, bin and production server. After hard-killing its server, it inspected the interrupted lease, verified absent owner and validated empty delivery history, entered maintenance, and invoked the existing hash-bound recovery API. The original ownership marker was archived, history preserved and delivery returned ready. This was explicit recovery of the disposable fixture, not automatic adoption or remote-outcome reconciliation.

The real launcher then fetched and fast-forwarded from a local bare Git repository, rebuilt and restarted. A second local update deliberately failed its build; the real updater rolled back, rebuilt the last good commit and restarted. Parent identity, home, keeper instance and maintenance state were preserved. No external repository was pushed, and this run made no model calls.

Server chain: boot 37064, acknowledged reload 49212, crash replacement 56156, successful update 66556, failed-update rollback 62616. The strict updater gate passed and cleanup verified launcher/keeper exit.

## Acceptance and independent QA

Regression tests cover crash budgets and cancellation, the actual full launcher/bin/demo server hard-crash path, durable Swarm checkpoints, root-hook concurrency and rejection, native input processing order, stale/malformed paste acknowledgement, ownership cancellation, and real child-process delivery-lease recovery. Adversarial live-evidence gates reject changed ownership, missing cleanup, task replay, unbound usage and incomplete updater evidence. Zero-native updater evidence cannot pass the authenticated adoption gate.

Final focused checks passed **177 tests across five suites**. Independent final semantic QA passed **171 tests across three suites**. These overlapping runs include the final input-disappearance guard and diagnostic wiring. Typecheck and production build passed, with the existing client chunk-size warning. Chromium execution-efficiency acceptance passed (one test, isolated port 4497); package install/version/demo-start smoke passed (isolated port 4496).

The first whole-backend run found 44 bootstrap failures caused by a missing mock export for the new runtime diagnostics. That mock was updated and a diagnostic wiring assertion added; the failed log is preserved as `output/launcher-coverage-initial-failed.log`. A subsequent run passed 3,809 tests but timed out its full-launcher HTTP probe after both server processes started. Focused normal and V8-enabled crash cases passed. The test now uses fresh connections across the hard kill, consumes the authentication response body, and identifies boot/replacement and route failures. Three consecutive full-launcher crash cases passed with the original timeouts and assertions unchanged; stale connection pooling is a plausible cause, not a conclusively reproduced diagnosis. The failed run remains in `output/launcher-coverage-crash-probe-failed.log`.

The final serial whole-backend coverage run exited zero: **201 files passed, 3,810 passing tests, two Unix-only skips and one existing TODO**. Backend branch coverage is **90.08% (12,140/13,476)** against the unchanged **90.01%** threshold. No coverage exclusions, test deadlines or thresholds were weakened. The real full-launcher crash acceptance passed in this final run. `output/launcher-source-freeze.json` hashes were unchanged at completion, including the final paste guard. Evidence: `output/launcher-coverage.log`, `output/launcher-final-qa-delta.log`, `output/launcher-final-semantic-qa.log`, `output/launcher-build.log`, `output/launcher-typecheck.log`, `output/launcher-e2e.log` and `output/launcher-package.log`.

## Reproduction and evidence

```powershell
node --import tsx scripts/verify-full-launcher-live.ts --live
node --import tsx scripts/verify-full-launcher-live.ts --live --updates-only
```

The first command remains expected to fail the full adoption gate until reconciled delivery recovery and safe retained-task resumption are integrated. Both commands require explicit opt-in; the second sends no agent prompt.

- `output/full-launcher-live.json`: actual failed forced-crash adoption proof.
- `output/full-launcher-live-paste-blocked.json`: preserved first startup/input failure.
- `output/full-launcher-blocker-review.json`: hashed read-only review of the preserved failed-run state; the chat remains queued, with the delivery blocker retained.
- `output/full-launcher-updates-live.json`: separate passing explicit recovery/update/rollback proof.
- `output/full-launcher-gate-qa.log`, `output/gemini-input-qa.log`, `output/launcher-delivery-hold-qa.log`: independent targeted checks.

## Remaining blockers

1. Integrate an explicit, reconciled delivery recovery workflow with retained-task adoption. Empty history can use the existing maintenance/snapshot-bound API; retained releases, runs or attempts need independent cloud-operation reconciliation. The failed chat is queued after native adoption is refused, so its previously submitted native outcome must be reconciled before maintenance is lifted and automatic dispatch can retry it. A stopped/quarantined native task must never be blindly replayed.
2. Repeat the authenticated full-stack in-flight crash case after that integration, requiring the same native process/session, one prompt, one completion, durable job clearance, conservative unknown usage and verified cleanup.
3. Update/rollback while a native task remains active is unverified; the passing updater run had no native tasks. Transient provider failures, Codex-specific provider recovery, delegation/billing completeness and tenant authoring/deployment acceptance remain outside this evidence.

The Agent Swarm runtime owner must implement the durable reconciliation/resume boundary; an independent QA owner must then repeat the strict physical adoption case. If retained cloud-operation history exists, the environment/release owner must supply verified operation outcomes before recovery can authorize new work. The failed fixture's lease has not been cleared and its queued task has not been retried.

No production readiness or deployment approval is granted by these local checks or bounded runtime probes.
