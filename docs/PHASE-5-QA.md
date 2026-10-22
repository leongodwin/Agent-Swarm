# Phase 5 implementation and independent QA

Verified locally on 2026-10-15. Existing Phase 0–4 working changes and unrelated untracked artifacts were preserved. No real coding-agent session, live office restart, tenant mutation, deployment, commit or push was performed.

## Implemented scope

Application-spec releases now require an explicit qualityEvidence contract mapping every scoped check and component to actual runner evidence. Compile, package, runtime, access, recovery and documentation coverage is required for each selected requirement/component. Slice scope includes selected requirements and transitive component dependencies; expansion covers the complete specification. Typed component and executable bindings are validated before release execution. Runtime/access bindings must agree with declared scenarios, executable categories/criteria and first-slice mappings.

Handover requires distinct user, administrator, operations and architecture Markdown files listed in the committed manifest. Files are bounded UTF-8, nonempty, contained source paths with declared headings. The office validates and retains the content from the exact pinned Git commit, rather than silently accepting generated/modified checkout files. Structural checks are explicitly insufficient for semantic documentation approval.

The runner retains successful build/test command receipts with originating retained attempt, execution time, manifest/command hashes and captured stdout. It binds package, validated recovery, fresh independent browser observations and pinned document snapshots into quality-evidence.json. The hash-bound index identifies every artifact and per-check evidence hash. Missing, mismatched or failed evidence blocks completion. Checkpoint reuse retains original command provenance only with matching source/manifest/package and valid origin/time.

The assigned independent QA session must supply a substantive decision for every exact check ID and evidence hash. Missing, duplicate, unknown, rejected or stale decisions refuse completion. Approval rehashes/reconstructs retained evidence and rechecks run/release/attempt state after asynchronous work. Per-check QA decisions survive restart. Trusted slice acceptance revalidates bytes again and stores a quality receipt; older execution-only receipts cannot unlock application-spec implementation/expansion. Legacy history remains readable without rewriting approved hashes.

## Acceptance evidence

| Acceptance criterion | Tests |
| --- | --- |
| Full scoped check-kind/component coverage and complete expansion coverage | server/qualityEvidence.test.ts; server/deliveryRecords.test.ts |
| Exact related scenario/criterion/category bindings and API denied-action hold | server/qualityEvidence.test.ts; existing firstSlice tests |
| Distinct handover roles, safe source paths, bounded UTF-8 and required headings | server/qualityEvidence.test.ts; server/delivery.test.ts |
| Pinned document bytes and executed command/package/recovery provenance in runner index | server/delivery.test.ts; server/qualityEvidence.test.ts |
| Reject wrong source, origin, time, output, package, recovery or missing evidence | server/qualityEvidence.test.ts |
| Failed compile/test or independent verification never creates an accepted quality index | server/delivery.test.ts |
| Reject incomplete, duplicate, rejected, stale or author-owned QA decisions | server/delivery.test.ts; server/qualityEvidence.test.ts |
| Session-bound QA MCP tool transports exact per-check decisions | server/ceo.test.ts |
| Persist/reopen approved decisions and reject post-approval document tampering | server/delivery.test.ts |
| Deny approval if a retry starts during asynchronous assessment | server/delivery.test.ts |
| Reuse unchanged checkpoint receipts; keep rerun evidence unique through pre-import retry/restart | server/delivery.test.ts |
| Pending versus accepted QA/documentation UI and actual per-check notes at desktop/mobile sizes | e2e/deliveryPlan.spec.ts; e2e/qualityEvidence.spec.ts |

External dependencies in runner integration tests are explicitly synthetic. These tests establish Agent Swarm orchestration behavior; they do not certify a deployed Power Platform app or the substance of real handover documentation.

## Independent QA findings and fixes

A separate read-only reviewer independently inspected the code and ran five files: 213 tests passed and one existing TODO. It reviewed the final gates, receipts, index reconstruction, schema ownership/cardinality checks and prompts. It reported no remaining actionable local/synthetic findings after fixes. It separately reviewed and passed the final retry/restart regression.

- Approval race: a retry could change the run during asynchronous evidence review. Added final run/release snapshot, active-state, phase and ownership checks before approval/decision persistence; the actual concurrent-retry test passes.
- Receipt provenance: command evidence lacked originating-attempt validation. Receipts now identify their retained originating attempt and require matching run/release/head/target/manifest/command, valid execution time and unchanged package proof. Reuse is explicit rather than forcing redundant successful builds.
- Final implementing review: rerun build/test receipt filenames could duplicate retained evidence entries during a pre-import retry. Receipt append now deduplicates names, with an actual failure -> retry -> restart test independently passed.

The first browser attempt opened the simulated ALM overlay because its fixture left demo UI enabled. Corrected the test fixture to select the real delivery UI with mocked responses; the server remained isolated demo mode. Both final browser tests passed. No production fallback was introduced.

## Final verification

- Full coverage run: 153 files passed, 2,465 tests passed, one existing TODO, no test failures or reported unhandled errors.
- Backend branches: 73.48% (9,294/12,647), below the unchanged 90.01% gate. Coverage command exited nonzero; production readiness remains blocked.
- Typecheck and client/server production build passed. Existing client chunk-size warning remains.
- Two isolated Chromium tests passed on desktop/mobile using port 4497 and a temporary demo home.
- The built npm package installed and started successfully in an isolated demo home on port 4496: two floors, 11 fake agents, client served.
- git diff --check passed; existing line-ending warnings remain.

## Remaining blockers and responsibilities

1. Whole-backend branch coverage must meet its required gate.
2. Real authenticated native-agent, compiler/App checker, tenant deployment, authorization and end-user journey evidence remains unperformed. Successful native-command return is not automatic platform compiler assurance; browser identity labels are not least-privilege proof.
3. API-only first-slice/quality acceptance needs a genuine denied-action adapter. Model-driven, Power Pages, code-app and other unsupported typed execution paths remain explicit blockers.
4. Owners must author/adopt real check matrices and handover content. Assigned independent runtime QA must inspect the actual assertions, documents, screenshots, permissions and recovery outcomes before accepting a real delivery. This repository test run does not perform that semantic approval.
5. Phase 6 retry/token telemetry is now documented separately in [PHASE-6-QA.md](PHASE-6-QA.md). Measured real-world efficiency improvements remain unverified. No token savings or production reliability percentage is claimed. The earlier intermittent terminal transport issue was not reproduced and is not declared fixed.

See [QUALITY-EVIDENCE.md](QUALITY-EVIDENCE.md) for the release contract, reviewer workflow and migration boundaries.
