# Server restart adoption and scheduler retry enforcement

15 October 2026. Follow-up to the earlier live-gap report. Existing repository changes were preserved. The protected installed Gemini bridge and running office were not changed or restarted.

## Authenticated server-process restart adoption: passed

`scripts/verify-gemini-server-restart.ts --live` starts two separate isolated runtime HTTP server processes, using the production cliRunner, PTY keeper, protected-profile validator and Gemini CLI 0.64.0. It does not simulate a restart inside one JavaScript process.

| Boundary | Observed evidence |
| --- | --- |
| Original server | PID 50296; processed the native BeforeAgent hook and observed zero model responses before exiting |
| Replacement server | PID 21656; opened the same loopback HTTP port and adopted the busy native session after fresh readiness verification |
| Keeper | PID 69884; instance 72fad184-fa2a-4aeb-88d6-3bb73d026b9a remained unchanged |
| Native Gemini | PID 27020; session 32e92ff9-1c8e-4d99-8819-0bce16a43656 remained unchanged |
| Completion | Exact synthetic CUBEFARM_RESTART_OK response; one task prompt, no resend |
| Accounting | Success outcome, unknown usage, null input/output/USD across the missed boundary |
| Cleanup | Both servers, native process and isolated keeper exited; independently checked |

The native response reported 28,418 input / 168 output tokens. These are native root-session observations, not attributed as measured to the adopted attempt. The final collector receipt correctly withholds them.

The first strict gate counted two native user records as two task prompts. Native 0.64 writes its initial session context as a separate user record. Independent QA checked the installed primary contract and actual record shapes. The corrected classifier requires exactly one native context, one exact task prompt and no unexplained user record. The original failed gate report is retained, and the same hash-checked native evidence was re-evaluated without repeating paid work.

## End-to-end scheduler retry enforcement: passed within the declared fixture

The real Swarm scheduler ran in four distinct Node processes against the same isolated state and execution ledger. No ledger attempts were preseeded and no direct assign shortcut was used. Three scheduler calls reached the authenticated native executor; each genuine fixed-marker response was deliberately rejected by synthetic semantic acceptance. The fourth server process repeatedly ran the scheduler and reached no executor entry.

| Process phase | Server PID | Cumulative reservations / launches | Native executor entries | Native input / output |
| --- | --- | --- | --- | --- |
| 1 | 46572 | 1 / 1 | 1 | 28,831 / 307 |
| 2 | 7536 | 2 / 2 | 1 | 28,940 / 478 |
| 3 | 70644 | 3 / 3 | 1 | 29,036 / 879 |
| 4 | 28508 | 3 / 3 | 0 | No native work launched |

Independent QA compared persisted ledger events, reservation/executor identities, state files and fresh native transcripts. All three reservations were automatic, bound to the same issue/scope/admission context, and ended as scheduler failures. Phase four retained the budget hold without adding a reservation or launch. Native sessions and evidence IDs were unique, timestamps/project hashes matched, and cleanup passed in every phase.

Scope is explicit: GitHub, repository preparation and capability readiness are synthetic. The native adapter keeps WorkerPreflight enabled in discovery mode and denies tools; this is a fixed no-tools verification task, not an authoring approval. A process-wide test-clock advance skips the scheduler cooldown; this is not an isolated clock override affecting only the scheduler. Model/session timestamps remain native wall-clock observations. The native response succeeds while synthetic task acceptance rejects it, so the production efficiency ledger conservatively withholds usage when runtime and task outcomes differ; it is not represented as complete accepted-task accounting.

An initial scheduler invocation was correctly blocked by missing authoring preflight before a native CLI ran. That failed report is preserved. The adapter was narrowed to discovery mode for its synthetic no-tools task; no production readiness controls were removed.

## Findings fixed

- Gemini persisted its native session ID only at completion. The verified root ID is now written to keeper metadata at startup, allowing adoption during the first busy turn. Empty, oversized, foreign and subagent identities cannot replace it.
- Retained Gemini adoption now revalidates the protected profile and native ACL/security check before ownership is committed.
- Old terminal input could pass through while adoption readiness was pending. Native readiness is now revoked before verification, direct terminal writes are withheld during admission, and failed/cancelled verification leaves input blocked until a successful fresh admission.
- Windows node-pty assigns the native PID after data-pipe readiness. The keeper now publishes the positive PID when it becomes available, allowing RemotePty and process ownership evidence to track the actual process.
- Strict verification gates reject missing cleanup, same-process faux restarts, changed keeper/native identity, prompt replay, unknown user records, unsafe/mismatched usage, unbound scheduler receipts, altered scope and fourth executor entries.

## Acceptance and independent QA

Focused acceptance passed **183 tests across seven suites**, with two Unix-only cases skipped on Windows. This includes a real two-process transport test, actual four-process scheduler regression with a synthetic executor, pending/failed profile and direct-input regressions, foreign root identity rejection, asynchronous PID publication, explicit-live guards and adversarial evidence gates. Independent live QA reported no remaining blocking findings in this implemented scope.

Typecheck and production client/server build passed, with the existing client chunk-size warning. The Chromium execution-efficiency acceptance passed on isolated port 4497 (one test). Package install/version/demo-start smoke passed on isolated port 4496 with two floors, eleven fake agents and the client served. Logs: `output/restart-build.log`, `output/restart-e2e.log`, `output/restart-package.log`. The final serial whole-backend coverage run exited zero: **195 files, 3,646 passing tests**, two Unix-only skips and one existing TODO. Branch coverage is **90.12% (12,091/13,416)** against the unchanged **90.01%** threshold. No coverage exclusions, test timeouts or thresholds were changed. Log: `output/restart-coverage.log`.

## Reproduction and evidence

From this source checkout, authenticated commands require explicit opt-in and use newly generated temporary homes. They never restart the live office:

```powershell
node --import tsx scripts/verify-gemini-server-restart.ts --live
node --import tsx scripts/verify-scheduler-retry-live.ts --live
```

- `output/gemini-server-restart-live.json`: independently approved physical restart/ownership proof.
- `output/gemini-server-restart-live-initial-gate.json`: preserved initial context-count failure.
- `output/scheduler-retry-live.json`: strict four-process scheduler proof and scoped native receipts.
- `output/scheduler-retry-live-preflight-blocked.json`: preserved preflight-blocked initial fixture run.
- `output/scheduler-native-receipts.json`: bounded native file hashes/counters from the exact synthetic project registry entry and three known session IDs; no global history search.
- `output/restart-final-focused.log`, `output/restart-independent-focused.log`, `output/restart-typecheck.log`: local acceptance and independent checks.

The report paths name isolated temporary roots containing per-process state/checkpoints/logs and the actual ledger. No credentials or model reasoning are copied into the evidence report. There was no tenant mutation, commit or push.

## Remaining verification boundaries

Follow-up: [Full launcher recovery QA](FULL-LAUNCHER-RECOVERY-QA.md) now records actual launcher/server hard-crash replacement and separate explicit recovery/update/rollback evidence. Authenticated full-stack task adoption was blocked by the interrupted delivery lease; the narrower passing runtime cases above do not close that integration gap.

No blocker remains for these isolated runtime-adoption and scheduler-budget cases. Full desktop launcher/self-update recovery, real repository and authoring-readiness integration, crash/forced-termination timing variants, and multi-agent concurrent restart stress remain broader release evidence. Genuine transient 429/5xx recovery, Codex provider-error recovery, delegated/ancillary accounting, billing reconciliation and deployed Power Platform acceptance also remain unverified. These passing cases do not establish production readiness for those paths.
