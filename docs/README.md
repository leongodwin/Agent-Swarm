# Agent Swarm documentation

Updated 15 October 2026. Documentation describes this source branch; it does not establish that the published npm package or default branch contains all changes. For delivery decisions, use the current status and exact release evidence. Dated tests and tenant observations remain historical evidence, not current readiness.

## Start here

- [Getting started](../README.md): prerequisites, Codex login, office setup and discovery-first delivery.
- [How it works](how-it-works.md): agents, independent QA, stage gates and runtime boundaries.
- [Delivery contract](DELIVERY.md): shared record, discovery, design, licences/manual governance, packaging, verification and acceptance tools.
- [Worker readiness](WORKER-READINESS.md): Phase 0 native-session evidence and Phase 1 skill/tool preflight contracts, rollout requirements and limits.
- [Application specification](APPLICATION-SPECIFICATION.md): Phase 2 journeys, questions, assumptions, component contracts and planned verification within the shared delivery record.
- [Phase 0–2 independent QA](PHASE-0-2-QA.md): findings, fixes, independently verified scope and remaining live/release blockers.
- [Current status](PRODUCTION-GOAL-STATUS.md): accepted backend scope and remaining full-app/production gaps.
- [Roadmap](AGENT-SWARM-IMPLEMENTATION-PLAN.md): current priorities followed by the historical implementation plan.
- [Backend pilot completion](BACKEND-PILOT-COMPLETION.md): deployed development slice, pinned identities, evidence custody and limitations.
- [Contributing](../CONTRIBUTING.md) and [agent instructions](../CLAUDE.md): source setup, isolated testing and project conventions.

## Historical validation and plans

These documents preserve dated observations and original acceptance boundaries. A “current” heading or process ID inside a historical checkpoint is scoped to that checkpoint. Later backend acceptance does not certify the earlier full application.

- [CODE_REVIEW](../CODE_REVIEW.md)
- [MYDEVNET-FLOW-COPILOT-VALIDATION](MYDEVNET-FLOW-COPILOT-VALIDATION.md)
- [RECOVERY-VALIDATION-2026-10-13](RECOVERY-VALIDATION-2026-10-13.md)
- [RELIABILITY-COMPLETION-PLAN](RELIABILITY-COMPLETION-PLAN.md)
- [RELIABILITY-VALIDATION-2026-10-11](RELIABILITY-VALIDATION-2026-10-11.md)
- [RELIABILITY-VALIDATION-2026-10-12](RELIABILITY-VALIDATION-2026-10-12.md)
- [TENANT-VALIDATION](TENANT-VALIDATION.md)

## Technical contracts and implementation evidence

- [Tracked ImportJob and authenticated adoption QA](TRACKED-IMPORT-ADOPTION-QA.md): explicit-target identity, durable pre-dispatch attribution, actual caller-crash/HTTP maintenance adoption and remaining full-pipeline limits.

- [Authenticated PAC/Dataverse resumption QA](PAC-DATAVERSE-LIVE-QA.md): disposable empty-solution import, genuine provider rejection, caller-crash evidence and remaining production adoption blockers.

These topic documents describe individual mechanisms and their tests, not whole-system or tenant certification. [Reliability](RELIABILITY.md) combines contracts with historical checkpoints; the current status takes precedence for completion claims. Recheck source and current authenticated evidence when operating a target. The recovery runbook remains scoped to its named target and procedure.

- [ADVANCED-CONNECTOR-CONSTRAINTS](ADVANCED-CONNECTOR-CONSTRAINTS.md)
- [ADVANCED-POLICY-DISCOVERY](ADVANCED-POLICY-DISCOVERY.md)
- [AGENT-JSON-BOUNDARIES](AGENT-JSON-BOUNDARIES.md)
- [AUTH-PROFILE-CONFIRMATION](AUTH-PROFILE-CONFIRMATION.md)
- [CAPABILITY-PUBLICATION](CAPABILITY-PUBLICATION.md)
- [CAPABILITY-READABLE-SNAPSHOTS](CAPABILITY-READABLE-SNAPSHOTS.md)
- [CLEANUP-COORDINATION](CLEANUP-COORDINATION.md)
- [CODEX-MODEL-METADATA](CODEX-MODEL-METADATA.md)
- [CODEX-PLANNING-STREAM](CODEX-PLANNING-STREAM.md)
- [COLUMN-CONTRACTS](COLUMN-CONTRACTS.md)
- [CONNECTOR-CATALOGUE](CONNECTOR-CATALOGUE.md)
- [CURRENT-ENVIRONMENT-SELECTION](CURRENT-ENVIRONMENT-SELECTION.md)
- [DATAVERSE-AUTH-BLOCKER](DATAVERSE-AUTH-BLOCKER.md)
- [DATAVERSE-RESOURCE-SCOPE](DATAVERSE-RESOURCE-SCOPE.md)
- [DELIVERY-ATTEMPT-HISTORY](DELIVERY-ATTEMPT-HISTORY.md)
- [DELIVERY-GOVERNANCE-HISTORY](DELIVERY-GOVERNANCE-HISTORY.md)
- [DELIVERY-JSON-BOUNDARIES](DELIVERY-JSON-BOUNDARIES.md)
- [DELIVERY-OUTPUT-INTEGRITY](DELIVERY-OUTPUT-INTEGRITY.md)
- [DELIVERY-STARTUP-RECOVERY](DELIVERY-STARTUP-RECOVERY.md)
- [DELIVERY-TREE-ACKNOWLEDGEMENT](DELIVERY-TREE-ACKNOWLEDGEMENT.md)
- [DEPLOYMENT-PACKAGE-PIN](DEPLOYMENT-PACKAGE-PIN.md)
- [DEPLOYMENT-SETTINGS-GOVERNANCE](DEPLOYMENT-SETTINGS-GOVERNANCE.md)
- [DURABLE-TENANCY-MUTATIONS](DURABLE-TENANCY-MUTATIONS.md)
- [EXPENSE-RECOVERY-RUNBOOK](EXPENSE-RECOVERY-RUNBOOK.md)
- [FLOW-ADAPTER-CLEANUP](FLOW-ADAPTER-CLEANUP.md)
- [FLOW-ADAPTER-CONNECTION](FLOW-ADAPTER-CONNECTION.md)
- [FLOW-ADAPTER-ENVIRONMENT](FLOW-ADAPTER-ENVIRONMENT.md)
- [GITHUB-FAILURE-BOUNDARIES](GITHUB-FAILURE-BOUNDARIES.md)
- [GITHUB-VERIFICATION-BOUNDARY](GITHUB-VERIFICATION-BOUNDARY.md)
- [GOVERNANCE-AUDIT-COMMIT](GOVERNANCE-AUDIT-COMMIT.md)
- [GOVERNANCE-EVIDENCE-PUBLICATION](GOVERNANCE-EVIDENCE-PUBLICATION.md)
- [GOVERNANCE-INPUT-OWNERSHIP](GOVERNANCE-INPUT-OWNERSHIP.md)
- [HEALTH-EVIDENCE-INTEGRITY](HEALTH-EVIDENCE-INTEGRITY.md)
- [HEALTH-EVIDENCE](HEALTH-EVIDENCE.md)
- [KNOWN-POLICY-DENIALS](KNOWN-POLICY-DENIALS.md)
- [LIFECYCLE-CANCELLATION](LIFECYCLE-CANCELLATION.md)
- [LIFECYCLE-GOVERNANCE](LIFECYCLE-GOVERNANCE.md)
- [NATIVE-COMMAND-OBSERVATIONS](NATIVE-COMMAND-OBSERVATIONS.md)
- [OPENCODE-COMPLETION-EVIDENCE](OPENCODE-COMPLETION-EVIDENCE.md)
- [OPENCODE-RATE-LIMIT-OWNERSHIP](OPENCODE-RATE-LIMIT-OWNERSHIP.md)
- [OPERATION-RETRY-OWNERSHIP](OPERATION-RETRY-OWNERSHIP.md)
- [PACKAGE-INVENTORY](PACKAGE-INVENTORY.md)
- [PACKAGED-RELATIONSHIP-COLUMNS](PACKAGED-RELATIONSHIP-COLUMNS.md)
- [PLANNING-CONFIGURATION](PLANNING-CONFIGURATION.md)
- [PLANNING-PROCESS-CLEANUP](PLANNING-PROCESS-CLEANUP.md)
- [READINESS-SHUTDOWN-BARRIER](READINESS-SHUTDOWN-BARRIER.md)
- [RECORD-SHARING-IDENTITY](RECORD-SHARING-IDENTITY.md)
- [RECOVERY-JSON-BOUNDARIES](RECOVERY-JSON-BOUNDARIES.md)
- [RELIABILITY-OBSERVATION-FRESHNESS](RELIABILITY-OBSERVATION-FRESHNESS.md)
- [RELIABILITY](RELIABILITY.md)
- [RESOURCE-SCHEMA-REFERENCES](RESOURCE-SCHEMA-REFERENCES.md)
- [RUNTIME-FALLBACK-OWNERSHIP](RUNTIME-FALLBACK-OWNERSHIP.md)
- [RUNTIME-MODEL-INHERITANCE](RUNTIME-MODEL-INHERITANCE.md)
- [RUNTIME-READINESS-REPLACEMENT](RUNTIME-READINESS-REPLACEMENT.md)
- [RUNTIME-REPLACEMENT-ADMISSION](RUNTIME-REPLACEMENT-ADMISSION.md)
- [SCHEMA-CASCADE-CONTRACTS](SCHEMA-CASCADE-CONTRACTS.md)
- [SCHEMA-DIAGNOSTICS](SCHEMA-DIAGNOSTICS.md)
- [SCHEMA-METADATA-CONSISTENCY](SCHEMA-METADATA-CONSISTENCY.md)
- [SCHEMA-PROVIDER-IDENTITY](SCHEMA-PROVIDER-IDENTITY.md)
- [SCREENSHOT-EVIDENCE](SCREENSHOT-EVIDENCE.md)
- [SYNTHESIS-COMPLETION-COMMIT](SYNTHESIS-COMPLETION-COMMIT.md)
- [SYNTHESIS-HISTORY](SYNTHESIS-HISTORY.md)
- [SYNTHESIS-MONOTONIC-TIMING](SYNTHESIS-MONOTONIC-TIMING.md)
- [SYNTHESIS-PROGRESS-PERSISTENCE](SYNTHESIS-PROGRESS-PERSISTENCE.md)
- [SYNTHESIS-RUNTIME-RECOVERY](SYNTHESIS-RUNTIME-RECOVERY.md)
- [SYNTHESIS-SKILL-BINDINGS](SYNTHESIS-SKILL-BINDINGS.md)
- [SYNTHESIS-TRACEABILITY](SYNTHESIS-TRACEABILITY.md)
- [TARGET-MEMBERSHIP-PAGINATION](TARGET-MEMBERSHIP-PAGINATION.md)
- [TENANCY-SHUTDOWN-BARRIER](TENANCY-SHUTDOWN-BARRIER.md)
- [TENANCY-SIGNIN-CONFIRMATION](TENANCY-SIGNIN-CONFIRMATION.md)
- [TERMINAL-TRANSPORT](TERMINAL-TRANSPORT.md)
- [TOOL-GOVERNANCE](TOOL-GOVERNANCE.md)
- [TYPED-SCHEMA-BATCHING](TYPED-SCHEMA-BATCHING.md)
- [UNAMBIGUOUS-GOVERNANCE-JSON](UNAMBIGUOUS-GOVERNANCE-JSON.md)
- [WORKER-DRAIN-ADMISSION](WORKER-DRAIN-ADMISSION.md)
- [WORKER-MODEL-HOLDS](WORKER-MODEL-HOLDS.md)
- [WORKER-PREFLIGHT-BACKOFF](WORKER-PREFLIGHT-BACKOFF.md)
- [WORKER-RECOVERY-DISPLAY](WORKER-RECOVERY-DISPLAY.md)

- [Task execution contracts](TASK-EXECUTION.md): scoped ownership, prerequisites, independent task review and merged input evidence.
- [Phase 3 QA evidence](PHASE-3-QA.md): acceptance matrix, independent findings/fixes and remaining release blockers.

- [First-slice execution](FIRST-SLICE.md): declared scenarios, component bindings and independent deployed-journey receipts.
- [Phase 4 QA evidence](PHASE-4-QA.md): acceptance coverage, independent findings/fixes and remaining runtime blockers.

- [QA and documentation evidence](QUALITY-EVIDENCE.md): mandatory per-check evidence and independent handover assessment for application-spec releases.
- [Phase 5 QA evidence](PHASE-5-QA.md): acceptance matrix, independent findings/fixes and remaining runtime blockers.

- [Execution efficiency](EXECUTION-EFFICIENCY.md): retained attempt usage, retry caps and incomplete-evidence limits.
- [Phase 6 QA evidence](PHASE-6-QA.md): acceptance tests, independent findings, verified checks and remaining blockers.

- [Phase 6 blocker remediation and evidence boundaries](PHASE-6-BLOCKERS-QA.md)

- [Codex and Gemini native usage contracts](NATIVE-USAGE.md): collector boundaries, acceptance evidence and remaining live verification.

- [Native usage live QA](NATIVE-USAGE-LIVE-QA.md): authenticated Codex observations, Gemini installation blocker and remaining live matrix.

- [Gemini administrator installation and authenticated QA](GEMINI-LIVE-QA.md): installed protected bridge, native matrix, fixes and remaining evidence.

- [Native usage live-gap follow-up](LIVE-USAGE-GAPS-QA.md): verified provider error/correction, ownerless adoption and durable retry holds; remaining full restart and accounting gaps.

- [Server restart and scheduler QA](SERVER-RESTART-SCHEDULER-QA.md): authenticated two-server adoption, real four-process scheduler hold and remaining release boundaries.
- [Full launcher recovery QA](FULL-LAUNCHER-RECOVERY-QA.md): physical launcher crash recovery, explicit empty-history recovery, real update/rollback and the blocked native adoption boundary.
- [Delivery lease and resumption QA](DELIVERY-LEASE-RESUMPTION-QA.md): opt-in no-cloud-history reconciliation, retained ownership, durable replay holds and authenticated adoption evidence.
- [Retained cloud reconciliation QA](RETAINED-CLOUD-RECONCILIATION-QA.md): bounded read-only terminal import observations, authenticated identity evidence and preserved deployment holds.

- [Native-command and target-lease reconciliation](NATIVE-TARGET-RECONCILIATION-QA.md): durable native intents, guarded target inventory, independent QA and remaining resumption implementation blockers.

See [native process ownership and lease handoff](NATIVE-LEASE-HANDOFF-QA.md) for the Windows proof mechanism, explicit maintenance resumption, crash rollback and remaining authenticated evidence.

See [pinned preparation recovery QA](PINNED-PREPARATION-RECOVERY-QA.md) for the explicit prebuilt-artifact route, normal-service live evidence and remaining custom-script recovery limits.

See [standard-M365 showcase end-to-end QA](AGENT-SWARM-M365-E2E-QA.md) for the real isolated office attempt, readiness repairs, independent findings and SharePoint/Canvas deployment blockers.

See [prerequisite readiness repair](PREREQUISITE-READINESS-QA.md) for instrumented deadline failures, bounded scheduling, actual-token identity checks and the unattended rerun.

- [Guarded SharePoint provisioning QA](SHAREPOINT-PROVISIONING-QA.md) — typed additive schema gates, independent findings and authenticated evidence boundaries.

- [Worker preflight contract QA](WORKER-CONTRACT-QA.md) — reviewed publication, native tool qualification, hook deadlines and live readiness boundaries.

- [Architecture and task contract recovery](PLANNING-CONTRACTS-QA.md) — draft-design admission, mandatory application task contracts and durable missing-input rejection.
