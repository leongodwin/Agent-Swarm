# Delivery lease reconciliation and retained-task resumption

Follow-up: [Retained cloud reconciliation QA](RETAINED-CLOUD-RECONCILIATION-QA.md) adds read-only terminal import observations while preserving all deployment and target leases. It does not extend the empty-history takeover authorization below.

15 October 2026. Follow-up to `FULL-LAUNCHER-RECOVERY-QA.md`. Existing repository changes and the running office were preserved. Authenticated probes use new temporary homes, copied production code and local-only Git origins; no tenant mutations or external pushes are authorized by this workflow.

## Recovery contract

Recovery defaults off. An operator can explicitly opt a launcher into narrowly scoped recovery by setting `SWARM_RECOVER_EMPTY_DELIVERY=1` before starting it. The launcher's crash controller passes the exact PID of its owned, unexpectedly exited server to its replacement. Ordinary startup, controlled reload and update overwrite that internal crash hint with an empty value. Operators should not set the internal `SWARM_CRASHED_DELIVERY_OWNER` hint.

Before Swarm reconnects native tasks, the replacement checks the real launcher IPC context, explicit opt-in, bounded valid PID, absent lease owner, strict unambiguous lease/state schemas and validated history containing no releases, runs or attempts. Recovery enters local maintenance and uses the existing snapshot-bound workflow to archive the exact interrupted marker and retain history. The archive receipt records the observed crashed PID, operator opt-in authorization and zero-operation scope; `remoteOutcomeVerified` remains false because no remote reconciliation was performed. Prior maintenance is restored only after delivery is available. Failures keep delivery unavailable and preserve its marker.

This is operator-authorized reconciliation of **no cloud-operation history**, not automatic takeover based only on a dead PID. Retained operation history, invalid/changed bytes, live or uninspectable owners, mismatched crash PIDs and unsupported startup contexts remain blocked. Environment variables configure a same-user launcher; they are not an OS security boundary.

## Retained-task ownership and replay prevention

CEO launches now supply the agent ID to the native runtime, just as developer launches already did. Previously a real CEO native process could survive but have an empty owner ID in keeper metadata; the replacement correctly refused it. Initial and adopted launches now bind to the same CEO owner and evidence identity.

Retained jobs with missing/unverified native ownership or failed readiness enter a persisted reconciliation hold. Their original job/checkpoint remains held, instead of being put on the automatic dispatch queue. Restart, time passing, new chat messages, desk reset and model/CLI changes cannot silently resend the submitted job. An explicit manager stop can cancel the held job; it must be preceded by review of the native outcome when side effects are possible. Newly queued work can then proceed through normal readiness. Cancellation does not certify the previous outcome or grant approval.

## Acceptance and independent QA

Targeted acceptance covers exact dead-owner binding, opt-in and launcher requirements, malformed/unsafe IDs, inaccessible/live owners, retained/invalid history, changed snapshots, audit/marker preservation, maintenance restoration, failed-storage holds, durable job holds across restart, explicit cancellation, and both initial/adopted CEO identity. Independent adversarial proof tests require the actual parent/server/keeper/native identity chain, one task prompt and completion, conservative accounting, unchanged history, an archived original marker and an authorized hash-bound receipt.

The final authenticated proof passed independent review. Targeted acceptance passed **467 tests across six suites**, before later negative-case additions. The final whole-backend coverage run exited zero: **202 files passed; 3,868 tests passed, two Unix-only skips and one existing TODO**. Branch coverage is **90.10% (12,191/13,530)** against the unchanged **90.01%** threshold; the new launcher recovery module covers all 20 branches. No coverage exclusions, test deadlines or thresholds were weakened. `output/reconciliation-source-freeze.json` production hashes remained unchanged at completion. Initial failures are retained as evidence, not described as passing adoption.

Typecheck and production build passed, with the existing client chunk-size warning. Chromium execution-efficiency acceptance passed (one test, isolated port 4497), and package install/version/demo-start smoke passed (isolated port 4496, two floors, eleven demo agents and client served). Logs: `output/reconciliation-coverage.log`, `output/reconciliation-build.log`, `output/reconciliation-typecheck.log`, `output/reconciliation-e2e.log`, `output/reconciliation-package.log` and `output/reconciliation-whitespace.log`. Independent proof-gate acceptance passed 142 tests; helper acceptance passed 26 tests. Those targeted counts overlap the final whole-backend run.

| Authenticated physical boundary | Observation |
| --- | --- |
| Owning launcher | PID 44988 |
| Original server / acknowledged reload | 72936 / 39984 |
| Server-only forced termination replacement | 35920, same launcher and home |
| Keeper | PID 61216, instance e408fcf0-8968-47e7-9410-6b0b63ba0719 unchanged |
| Native Gemini | PID 62100 unchanged across the crash; session 2791761c-42e1-408e-a60f-9b8b7391e745 |
| Native completion | One exact fixed-marker response, one task prompt, one native initial context, no unknown user record |
| Durable completion | CEO done, job null, same session ID |
| Lease reconciliation | Original marker archived; history byte hash unchanged; receipt bound to crashed PID 39984 and the exact snapshot |
| Accounting | Adopted receipt success, unknown attempt usage, null input/output/USD; original receipt remains unfinished |
| Update / rejected-build rollback | Servers 33508 / 53492; native inventory zero after task completion |
| Cleanup | Owned native PID absent, keeper cleanup verified, launcher exited |

Native root-session usage reported 33,710 input and 12 output tokens (751 thought tokens, zero tool tokens). Those counters are not attributed as measured to the adopted attempt. They do not establish billing completeness.

The first two attempts correctly held unbound native ownership after successful lease recovery; their evidence led to the missing CEO agent ID fix. The successful physical run initially failed its aggregate harness gate: it had read the public AgentView for a session ID that the API deliberately omits, and incorrectly required a native process to remain during updates after the CEO task completed. The original report is retained as `output/reconciled-adoption-initial-gate.json`. Independent read-only review recovered the same ID from hashed persisted state, checked the exact native transcript and archived marker/history hashes, verified the native PID's absence and local Git rollback head, and passed the physical/adoption gate plus the explicitly zero-native updater gate. No extra provider call was made to correct the evidence classification. The future harness reads the durable completion checkpoint and observes native exit before updates.

The live copied build predates the final cancellation-only checkpoint-clear fix. Independent negative tests verify that fix locally; the authenticated positive adoption path did not exercise cancellation. Update/rollback in this run occurred after native completion, so it does not certify update retention of an active task.

The native PID absence is a timestamped observation, not a claim about the current PID. Independent QA later found that Windows reused 62100 for an unrelated process created after that observation. It did not terminate or modify that process; verified keeper/launcher cleanup and the historical native-exit observation remain separate evidence. See `output/reconciliation-independent-live-review.json` for the review and hashes.

## Reproduction

After a production build, from this checkout:

```powershell
node --import tsx scripts/verify-full-launcher-live.ts --live --reconcile-empty
```

This command explicitly opts only its disposable launcher into recovery. It performs an authenticated fixed-marker no-tools CEO task, kills only its owned server PID, checks native adoption, then exercises local update and failed-build rollback. It drains and stops its own native/keeper/launcher processes and retains evidence. Its deliberately unavailable tool-governance audit denies tools; passing this runtime probe does not establish authoring/governance or deployment readiness.

Evidence: `output/reconciled-adoption-live.json`, `output/reconciled-adoption-live.log`, `output/reconciliation-final-focused.log`, `output/reconciliation-independent-qa.log` and `output/reconciliation-gate-qa.log`. Earlier failed attempts are preserved separately as `output/reconciled-adoption-missing-native.json` and `output/reconciled-adoption-unbound-ceo.json`.

## Remaining boundaries

Delivery history containing releases, runs or attempts still requires independent cloud-operation reconciliation; it cannot use this zero-history recovery. Held unknown native outcomes require human review before cancellation/reissue. Authenticated simultaneous-agent restart stress, crash timing during an actual platform mutation, transient provider recovery, Codex-specific recovery and complete billing/delegation accounting require separate live evidence. No production or Power Platform delivery approval follows from these bounded checks.
