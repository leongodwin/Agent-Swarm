# Phase 3 implementation and independent QA

Verified locally on 2026-10-15. Existing Phase 0–2 working changes and unrelated untracked artifacts were preserved. No commit, live office restart, real model session, tenant change or deployment was performed.

## Delivered

Opt-in execution contracts link issue owners to components, explicit dependency issues, shared resources, inputs, outputs, checks and stop conditions. The office validates links and cycles, requires exact scoped independent review, injects bounded task context, reserves component/resource claims before asynchronous preparation and enforces owners across scheduling, repairs and continuations. Global resources coordinate connected projects; component IDs remain project-local.

Scope hashes include the transitive dependency closure and relevant requirements, interfaces, security and discovery. Unrelated scope edits preserve valid task approvals and receipts; affected work loses authority. Legacy records retain existing gates until explicitly adopting taskPlan. Global design, slice and release approvals still require current record evidence.

The merge observer records acceptance only for the exact independently tested head merged to the default branch and linked to the task. Dependencies require durable receipts and merge-commit ancestry in the authoring checkout. Failed receipt persistence holds dependent work and reconciles without repeating the remote merge.

## Acceptance evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Reject invalid owners, links, checks, missing prerequisites and cycles | server/deliveryRecords.test.ts |
| Require exact scoped QA and merged dependency receipts | server/deliveryRecords.test.ts; server/taskExecution.test.ts; server/github.test.ts |
| Preserve unrelated approvals and invalidate edited dependencies | server/deliveryRecords.test.ts |
| Reject stale persisted hashes, reviewer or slice provenance | server/deliveryRecords.test.ts |
| Bound context and expose contracts to workers/reviewers | server/deliveryRecords.test.ts; office tool test; UI browser case |
| Enforce owners and reserve resources before async preparation, including across projects | server/swarmLifecycle.test.ts |
| Deny missing prerequisite ancestry before fresh or resumed authoring | server/taskExecution.test.ts; server/swarmLifecycle.test.ts |
| Prevent stale scope at QA posting, merge and retained-session adoption | server/swarmLifecycle.test.ts |
| Retain visible publication blocker and reconcile without a duplicate merge | server/swarmLifecycle.test.ts |
| Desktop/mobile contract display and unavailable-state clearing | e2e/deliveryPlan.spec.ts |

## Independent QA

A separate read-only QA agent reviewed the code and independently ran five test files: 324 tests passed. QA found two P1 defects: retained sessions could adopt new authority while keeping old instructions; stopped/typed continuations could skip prerequisite ancestry. Both were fixed and independently retested. Regression tests include actual downtime adoption with unchanged, changed and missing original scope. QA reported no remaining actionable code findings and approved the implementation within local/synthetic scope.

## Final checks

- TypeScript checking and production build passed.
- Full suite with coverage: 151 files, 2,429 passed tests, one existing TODO; no test failures.
- Backend branches: 72.78%, below required 90.01%. Coverage command exited nonzero; the gate remains unchanged and blocks production-readiness claims.
- Isolated demo browser test passed on port 4497, including desktop/mobile checks.
- Built npm package installed and started successfully in an isolated demo home on port 4496; two floors, 11 fake agents, client served.
- git diff --check passed (existing line-ending warnings only).

## Remaining limits and ownership

Live authenticated native-runtime, GitHub merge and Power Platform authoring/deployment/journey verification remain unperformed. Synthetic tests establish orchestration behavior, not production tenant acceptance. Independent runtime QA must verify a real scoped task and deployment through existing delivery gates before release.

Contract adoption is explicit: legacy projects are not automatically migrated. The delivery owner must supply canonical resource identifiers and meaningful task inputs, outputs, stop conditions and checks; independent QA must inspect their adequacy. Structured stop conditions are agent instructions and do not sandbox arbitrary external tools. Broader first-slice delivery, mandatory documentation/QA evidence and retry/token telemetry remain later phases. Actual token or retry savings have not been measured.

A previously observed transient loopback terminal test timeout/socket error from Phase 0–2 was not reproduced by this final run; its earlier investigation is not closed by a passing synthetic suite.

Follow-up: Phase 4 first-slice execution and independent QA are recorded in [PHASE-4-QA.md](PHASE-4-QA.md). Remaining-work statements above describe the Phase 3 checkpoint.
