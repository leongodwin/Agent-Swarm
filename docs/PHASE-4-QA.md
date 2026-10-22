# Phase 4 implementation and independent QA

Verified locally on 2026-10-15. Existing Phase 0–3 changes and unrelated untracked artifacts were preserved. No live office restart, real coding-agent run, tenant mutation, deployment, commit or push was performed.

## Implemented scope

First-slice releases for application specifications now connect the declared journey to executable browser tests and typed target components. Mappings must cover selected components and transitive dependencies, relevant runtime/access checks and every selected journey scenario, including happy, denied and failure cases. Distinct scenarios require distinct executable tests. Invalid mappings stop release preparation before build/import. Existing compile, package, recovery, cloud-flow and Copilot checks remain in force.

The runner writes first-slice-verification.json only after independent execution succeeds. Its evidence binds the exact record, execution contract, release, plan, source commit, target and package to mapped cases. Observations must match names, categories, criteria, identities and desktop/mobile viewports; timestamps must be fresh for the current verification attempt. This artifact joins the hash-bound evidence set.

Independent visual approval reconstructs/rechecks first-slice proof. The trusted accept_slice adapter rehashes retained evidence before the shared receipt is written. The receipt carries execution-contract, artifact, record and plan hashes. Application-spec implementation and expansion remain blocked by legacy receipts lacking that proof. Retained legacy records remain readable; this is no automatic migration or re-approval.

## Acceptance tests

| Acceptance | Evidence |
| --- | --- |
| Complete component/dependency, scenario and check mappings; invalid or unrelated links rejected | server/firstSlice.test.ts |
| Happy, denied and failure scenarios mapped to appropriate executable categories | server/firstSlice.test.ts |
| Missing/unsupported typed target map stops release preparation | server/firstSlice.test.ts; server/delivery.test.ts |
| Missing, failed, stale, wrong-target or incomplete viewport/identity observations block acceptance | server/firstSlice.test.ts; server/delivery.test.ts |
| Real runner path emits bound proof, retains it across restart and refuses tampering before/after QA | server/delivery.test.ts (injected synthetic external dependencies) |
| Current merged task evidence and trusted byte verification required before slice receipt | server/deliveryRecords.test.ts |
| Legacy receipt cannot unlock application-spec expansion with or without taskPlan | server/deliveryRecords.test.ts |
| API-only Phase 4 first slices fail closed without a denied-action adapter | server/firstSlice.test.ts |
| Planned versus verified first-slice state, responsive layout and unavailable-state clearing | e2e/deliveryPlan.spec.ts |

These are acceptance tests of Agent Swarm orchestration. Injected external dependencies are explicitly synthetic; they are not evidence of a real deployed Power Platform app.

## Independent QA findings and fixes

A separate read-only QA agent reviewed the mapping, source/record/plan/target binding, freshness, tampering checks, restart behavior and trusted receipt wiring. It independently ran seven files: 202 tests passed. It reported no remaining actionable code findings after fixes.

- P1: A legacy receipt could satisfy the expansion gate for an application specification. Fixed the expansion gate and added both taskPlan and no-taskPlan regression cases.
- P1: API GET assertions labelled authorization did not execute a genuine denied-user action. API-only Phase 4 first slices now stop with an explicit missing denied-action adapter. Existing non-Phase-4 backend functional-development verification remains supported.
- Documentation: corrected signed-evidence wording to hash-bound evidence and removed API first-slice support claims.

## Final verification

- Full coverage run: 152 files passed, 2,444 tests passed, one existing TODO, no test failures or reported unhandled errors.
- Backend branch coverage: 73.13%, below the unchanged 90.01% requirement. The coverage command exited nonzero; release readiness remains blocked.
- Typecheck and client/server production build passed. Existing client chunk-size warning remains.
- Isolated Chromium delivery-plan test passed, including desktop/mobile and accepted/pending/unavailable first-slice states (port 4497, temporary demo home).
- npm package installed and started successfully in an isolated demo home on port 4496; two floors, 11 fake agents, client served.
- git diff --check passed; existing line-ending warnings remain.

## Remaining blockers and independent runtime QA

1. Whole-backend coverage still misses its required gate.
2. API-only first slices need a genuine runner-owned denied-action adapter. Typed first-slice adapters for model-driven apps, Power Pages, code apps and other platforms remain unsupported and explicitly blocked; this change supplies no generic success fallback.
3. Real authenticated native-agent, GitHub, authoring, deployment, role/identity and end-user journey evidence remains unperformed. Independent runtime QA must inspect actual target mappings, assertions, screenshots, recovery and the bound proof before release. Browser identity observations alone do not establish least-privilege security.
4. Existing owners must adopt and independently review application specifications and execution mappings. Mapping completeness is structural; outcome/assertion adequacy remains a QA responsibility.
5. Broader documentation/QA evidence enforcement and retry/token telemetry remain later phases. No measured token-saving or production-reliability claim is made. The earlier intermittent terminal transport issue was not reproduced and is not declared fixed by these runs.

Follow-up: Phase 5 QA/documentation enforcement and independent verification are recorded in [PHASE-5-QA.md](PHASE-5-QA.md). Remaining-work statements above describe the Phase 4 checkpoint.
