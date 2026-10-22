# Phase 6 blocker remediation — 15 October 2026

> Newer evidence: [actual server restart and scheduler retry enforcement](SERVER-RESTART-SCHEDULER-QA.md). Earlier restart/scheduler gaps below describe their historical snapshot.

> Latest follow-up: [provider recovery, retained adoption and durable retry holds](LIVE-USAGE-GAPS-QA.md). Earlier provider-error blockers below describe their historical snapshot.

> Current Gemini follow-up: [administrator installation and authenticated QA](GEMINI-LIVE-QA.md). The earlier installation blocker below is historical; provider-error evidence remains outstanding.

This follow-up preserves existing Phase 0–6 changes and the whole-backend 90.01% branch gate. It adds acceptance tests against failure, cancellation, authority, retention and recovery contracts. Tests use isolated homes, synthetic inputs and mocked native/platform/GitHub transports; real in-memory MCP SDK tests exercise dispatch without an external model or tenant.

## Findings fixed

- Retained acceptance replay repeatedly scanned the complete event list to find duplicates. The maximum-history regression exposed quadratic cold-start work. A Set now retains acceptance identities for replay and idempotence; maximum retention remains bounded and corruption still holds work.
- Demo merges accepted closed/already merged pull requests. Non-OPEN merges now reject before mutating issue state or sync counts.
- The offline session summary used weaker validation than the execution dashboard. Both now use the strict reader: stable identity/sequence, ordered timestamps, one initial start, terminal finish and safe files. Nonterminal/missing finish outcomes, symlinks, malformed bytes and incomplete usage cannot become measured costs. Absent measured cost is null. Old unproven counters remain unknown.
- A completed QA run could grant a pass after required screenshot upload or comment publication failed. Required receipt failures now hold `needs-human`, clear the approved head and comment authority, retain observed checks/summary/tested head, and preserve failure budgets. The automatic scheduler does not launch code repairs or repeat model QA for this publication outage. Late ownership/scope changes still invalidate the result. Operators must restore publication access and independently reconcile retained evidence before approval.

- Explicit manager QA retries were still filtered by the automatic cap. A one-use, record-bound permit now enables the requested retry while retaining scope, ownership, readiness and storage checks. Automatic queueing cannot mint or reuse this permit, and a refused reservation leaves no phantom active reviewer. Restart discards unused permissions.

- Independent race testing found a stopped demo preview could bind after its listener reference was cleared. The late listen callback now closes the captured server object and never announces running after stop. This is verified with a simulated listener acknowledgement; native operating-system cleanup remains a separate boundary.

## Meaningful acceptance coverage

New suites cover scheduler ownership, stale callbacks, quota/fallback behavior, retained-session boundaries, refusal to merge changed or unverified heads, same-head QA reuse, failed publication, immutable receipts, record revisions, MCP dispatch revocation and privilege boundaries, native transport cancellation/cleanup, command/output limits, provider metadata failures, package/source completeness, preview/workspace preservation, synthesis and tenancy wrappers. Diagnostic tests check bounded output, path normalization and missing fields rather than merely repeating static labels.

The repository-wide coverage denominator and threshold are unchanged. Focused coverage is diagnostic only. A passing focused suite does not substitute for the global gate. The first broad run found the retention performance issue; a later concurrent run timed out in two existing delivery cases. Bounded-concurrency verification is recorded below; timeouts were not increased.

## Final verification

- Final whole-backend command: `npm run test:coverage -- --maxWorkers=1 --coverage.reportOnFailure`, exit 0. All 181 files passed: 3,340 tests passed, two Unix-only tests skipped on Windows, and one existing TODO.
- Branches: **90.07% (11,771/13,068)**, clearing the unchanged **90.01%** gate. Statements 93.92%, functions 92.61%, lines 97.43%. The original Phase 6 snapshot was 73.75%; no threshold, coverage include/exclude, or timeout was changed.
- A preceding two-worker run reached the same coverage but exited nonzero because one real local Git integration test exceeded its existing five-second timeout. The final serial run passed that test and the entire suite. Serial execution avoids concurrent test-worker load; the earlier timeout remains a recorded test-timing limitation.
- Global TypeScript checks and client/server build passed. The existing client chunk-size warning remains.
- Chromium execution-efficiency acceptance passed on reserved port 4497 with an isolated demo home, including stale-report clearing and unknown/measured/retry-hold assertions.
- Pack/install/version/demo-start smoke passed on reserved port 4496 with an isolated home: two floors, eleven fake agents and the packaged client served.
- Independent QA reviewed the implementation fixes, coordinator acceptance tests, Codex trust/RPC/planning tests and evidence wording. All actionable findings were fixed and retested; no further actionable findings were reported. The final independent focused batches passed 90 trust/RPC/planning tests, 120 runtime/package/cleanup/publication tests and 130 delivery/demo/release/tenancy tests, alongside bootstrap/HTTP tests and earlier coordinator reviews.
- Existing changes were preserved. No real coding agent, tenant mutation, live office restart, GitHub publication, commit or push was performed.

Evidence logs: `output/phase6-blockers-coverage-final.log`, `output/phase6-blockers-build.log`, `output/phase6-blockers-e2e.log`, and `output/phase6-blockers-package.log`. These establish local repository verification; they do not grant deployed application or production approval.

## Evidence still required

| Boundary | Required independent evidence | Current status |
| --- | --- | --- |
| Installed OpenCode version/counter contract | Pin installed CLI/plugin/model versions, run a dedicated authenticated synthetic task, correlate root prompt/session/attempt and native counters including failed/retried work | Not performed; protocol tests only |
| Codex/Gemini usage collectors | Verify authenticated installed-provider hook/write timing and failed/retried/resumed/adopted work | Implemented against pinned installed-version source contracts with local acceptance tests; see [native usage](NATIVE-USAGE.md). Live runtime evidence remains outstanding; USD remains unknown |
| Complete office cost and savings | Include CEO/synthesis and pre-reservation work, a defined historical window and comparable before/after tasks; reconcile actual provider billing separately | No whole-office, billing or savings claim |
| Real QA artifact publication | Real repository permissions, accessible screenshot/comment receipts, outage/recovery proof and unchanged PR-head/owner review | Mocked receipt tests only |
| Power Platform delivery | Current target manifest, authenticated supported tools, compiler/App checker and package/import results, correct bindings, real URLs, authorization/denied-action and recovery journeys under required identities | Existing live blockers remain |
| Independent application/documentation approval | Assigned independent reviewer examines the actual current release, assertions, screenshots, role behavior and user/admin/operations/architecture handover | Local repository QA does not grant this approval |
| Platform/runtime portability | Native process-family cleanup and retained-session behavior on supported operating systems/provider versions | Windows synthetic checks only; Unix-specific skipped tests require their platform |
| Retained history ownership | One office process per home; deliberate operator-owned export/archive/reconciliation before storage repair | No multi-process/tamper-proof audit service or all-time completeness claim |

No live credentials, identities, configuration values or provider usage are invented by these tests.
