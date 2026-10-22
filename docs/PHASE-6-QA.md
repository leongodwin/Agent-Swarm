# Phase 6 QA — 15 October 2026

Phase 6 adds durable execution telemetry, conservative measured usage, accepted-task efficiency reporting and automatic retry budgets. Existing Phase 0–5 work and unrelated working-tree changes were preserved. No live office, coding-agent project, GitHub repository or Power Platform tenant was changed.

## Acceptance criteria and evidence

| Criterion | Acceptance evidence |
| --- | --- |
| Reserve before asynchronous checks; retain blocked attempts and link native sessions | executionLedger.test.ts; swarmLifecycle.test.ts |
| Three automatic reservations per unchanged scope/configuration; restart-safe and race-safe synchronous reservation | executionLedger.test.ts; actual developer and QA scheduler tests in swarmLifecycle.test.ts |
| Automatic no-PR and restart continuations consume the budget; explicit manager retry still requires intact storage | swarmLifecycle.test.ts; reviewed coordinator paths |
| Model completion cannot become independent acceptance; stale scope/PR head/reviewer cannot enter current acceptance denominator | executionLedger.test.ts; scoped acceptance callback review; existing taskExecution/deliveryRecords gates |
| Native per-prompt work deduplicates notifications; absent, malformed or cumulative usage cannot become zero | nativeUsage.test.ts; openCodeGovernance.test.ts; sessionEvidence.test.ts |
| Session identity, role, runtime, timestamps and terminal outcome must match the coordinator attempt | executionLedger.test.ts; sessionEvidence reader; independent source review |
| Missing earlier/out-of-window attempts withhold accepted-task ratios | executionLedger.test.ts |
| Corruption, changed bytes and exhaustion preserve history and hold reservations | executionLedger.test.ts; storage implementation review |
| Authenticated repository-scoped metadata only, including export terminal events and no-store responses | officeHttp.test.ts; executionLedger.test.ts |
| Unknown usage, partial collection, automatic holds and failed refresh remain explicit at desktop/mobile sizes | e2e/executionEfficiency.spec.ts |

## Independent QA

A separate read-only reviewer independently inspected the implementation, ran 397 tests across eight files, and reviewed/retested the final recovery delta with four targeted passing tests. It reported no remaining actionable local finding in the reviewed scope. These are synthetic orchestration/protocol tests, not live platform or billing acceptance.

Findings fixed: automatic QA and no-PR/restart continuations bypassed the budget; scheduler role and issue-less QA identity differed from reservation identity; automatic intent could be lost after an await or failed reservation; retained-session runtime and effective configuration provenance needed correction; accepted-task calculations could omit older attempts; finish-only session files could carry usage; sample accumulation was not bounded. Added regression coverage and conservative provenance checks. The final provenance audit also excluded busy adopted-process counters that can predate a coordinator attempt; independent QA passed its 57-test retest. An initial full run exposed an obsolete prototype-test stub; it now supplies the newly required telemetry method and its original pause assertion passes.

## Verification

The full-suite coverage run passed 155 files and 2,487 tests with one existing TODO and no test failures. Backend branches were 73.75% (9,610/13,030), below the unchanged 90.01% gate; the command exited nonzero. After that run, the final busy-process attribution safeguard and its persisted-counter regression passed 57 focused tests independently, including one new test. The complete suite was not repeated after that narrow delta. Typecheck and production client/server build passed, with the existing client chunk-size warning. Isolated npm package install/demo startup passed on port 4496 with two floors and 11 fake agents. Chromium acceptance passed with desktop/mobile assertions on port 4497 and a temporary demo home. No production readiness claim follows from these checks.

## Remaining blockers and ownership

- Whole-backend branch coverage must meet the unchanged 90.01% release gate.
- Runtime owners must validate the installed OpenCode message contract using real authenticated evidence. Codex/Gemini native usage collectors remain unsupported; they report unknown usage.
- CEO/synthesis costs, requests rejected before coordinator reservation, pre-collection history and archived files are outside this metric. No invoice reconciliation, all-time completeness or measured token-savings claim is made.
- Retention deliberately holds at 8 MiB/10,000 events. An operator must preserve/export and reconcile archives before repair; there is no multi-process ledger owner or tamper-proof external audit service.
- Existing tenant/compiler/App checker, authorization, complete deployed journey, denied-action adapter and unsupported platform path blockers remain. Assigned independent runtime QA must approve the real application and documentation against current release evidence.

See [EXECUTION-EFFICIENCY.md](EXECUTION-EFFICIENCY.md) for measurement and recovery semantics.

Follow-up: [coverage and blocker remediation](PHASE-6-BLOCKERS-QA.md). The results above describe the original Phase 6 snapshot.
