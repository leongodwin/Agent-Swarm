# Independent QA and Phase 2 follow-through — 15 October 2026

A separate reviewer agent inspected the uncommitted changes, ran independent local/synthetic tests and did not modify the implementation. The implementing agent fixed findings and requested retests. Neither agent invoked native coding agents against a live project, changed tenant state or migrated live preflight contracts.

## Findings and fixes

| Finding | Fix | Independent disposition |
| --- | --- | --- |
| P1: Gemini/OpenCode native platform tool names could not match canonical preflight names | Explicit reviewed per-runtime aliases; no inferred provider/name splitting | Closed |
| P1: OpenCode clipped complete skill evidence at 16,000 characters | Retain complete bounded hook evidence; oversized output reports failure; generated-plugin integration covers large guidance | Closed |
| P2: Serialized/nested provider failures appeared as unknown audit outcomes | Shared bounded interpretation for readiness and audit | Closed |
| P2: Every tool repeatedly rediscovered/hashed the entire skill catalogue | Resolve once and verify pinned content/configuration/plugin version at subsequent checkpoints | Closed |
| Discovery before a known target could not satisfy authoring readiness | Stage-selected read-only discovery/design mode; reviewed external read probes remain explicit; completion labelled discovery-only; QA always retains authoring gates | Closed |
| Discovery prompts demanded shell/build/push/PR steps denied by their gate | Complete stage-specific workflow, including legacy fix assignments; no record-only PR retry | Closed |

Independent retests included 128 passing Phase 0/1 tests, review of the Phase 2 record/schema/history/synthesis changes, a 203-test swarm lifecycle run, and final targeted assignment tests (3 passed, 200 intentionally skipped). The reviewer reported no remaining actionable implementation finding within the reviewed scope. This is local/synthetic approval, not live platform or production approval.

## Phase 2 implemented scope

The existing shared delivery record now optionally carries a versioned application specification with journeys/scenarios, decisions and answer sources, evidence-linked assumptions, component owners/dependencies, security boundaries and planned verification checks. Referential errors/cycles block saves; material questions and unsupported critical assumptions block design progression. Record changes invalidate previous design/slice approval, and architecture synthesis receives hash-bound specification items. Removing an existing specification silently is refused.

The delivery-plan UI displays the new information and distinguishes planned checks from verified results. The implementing agent's isolated Chromium test passed on desktop/mobile, including stale-data clearing after a failed refresh. The reviewer inspected the UI logic but did not independently rerun that browser test. Legacy records remain readable and explicitly lack Phase 2 specification completeness; they are not automatically migrated or re-approved.

## Final local validation

- Whole suite: 150 files passed, 2,407 tests passed and one existing TODO.
- Coverage command exits nonzero: backend branch coverage is 72.80% (8,628/11,851), below the unchanged 90.01% gate.
- Typecheck and client/server production build passed; the existing large-client-chunk warning remains.
- Isolated desktop/mobile Chromium delivery-plan test passed, including question visibility, planned-versus-verified wording, responsive layout and stale-data clearing.
- Packaged installation/demo startup passed using a temporary office home and reserved test port 4496; this checks packaging and local startup only.

## Remaining blockers and scope limits

- Real provider/runtime tool names and result envelopes, authenticated identity/target/access, retained-session recovery and actual authoring/runtime journeys still require approved live evidence.
- Owners must prepare and independently review real authoring preflight contracts. No contracts or target bindings were fabricated or installed in existing projects.
- Native token ingestion, complete pre-assignment telemetry, a dashboard and evidence-retention operations remain incomplete; no token-saving or sustained reliability improvement is claimed.
- Whole-backend coverage must still meet the unchanged 90.01% gate. Passing tests/builds alone do not establish release readiness.
- An earlier broad run encountered a loopback terminal transport timeout and unhandled socket error. Its isolated rerun passed; that does not prove the intermittent transport issue is fixed.
- Specification checks establish structure and provenance links, not semantic correctness or complete intended-user acceptance. Phase 3 dependency-aware task enforcement, Phase 4 broader first-slice delivery, Phase 5 mandatory QA/documentation evidence and Phase 6 cost/recovery optimisation remain further implementation work. Existing platform delivery capabilities are not re-certified by this change.

See [worker readiness](WORKER-READINESS.md) and [application specification](APPLICATION-SPECIFICATION.md) for the source contracts and operational boundaries.

Follow-up: Phase 3 execution contracts and their independent QA are now recorded in [PHASE-3-QA.md](PHASE-3-QA.md). The remaining-work statement above describes the Phase 0–2 checkpoint.
