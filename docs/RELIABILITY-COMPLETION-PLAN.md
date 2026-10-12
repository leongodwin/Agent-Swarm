# Plan to close the three remaining reliability gaps

Prepared 10 October 2026 from the recorded tenant-validation results. This is an execution plan; no additional deployment, sign-in or restoration is performed by creating it. Refresh live state before execution.

## Targets and scope

- Connected deployment environment: MyDevNet, `https://org0efd6060.crm4.dynamics.com`.
- Authorized import/recovery environment: Development, `https://org68dad46d.crm4.dynamics.com`.
- Maker: `leon@graspai.co.uk`, tenant `5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c`.
- Application: Corporate Expense Management in `leongodwin/Expnese-App2`.
- Starter validation: Canvas Apps, Power Pages, Dataverse, Power Automate and deployment, each validated separately.

The current Expense package includes schema and roles only. Completing this plan includes implementing and packaging missing application components, not merely rerunning existing tests. The current independent browser verifier supports same-origin DOM applications; Canvas/iframe and API-only verification need supported adapters before those releases can pass honestly.

## Phase 1 — Establish verified Dataverse MCP access

1. Inspect existing authentication jobs/profiles. Reuse a completed matching profile; otherwise cancel only our stale attempt and generate a fresh interactive sign-in. Do not reuse the previous device code.
2. The manager completes Microsoft sign-in/MFA as the approved maker. If tenant consent is actually refused, record the exact requested permission and service-generated consent instructions for the tenant administrator; do not widen permissions speculatively.
3. Verify the CLI profile, tenant, environment URL and actual Dataverse user. Keep deployment and rehearsal targets explicit in every command.
4. Register Dataverse MCP for the agent runtimes actually used by the office. Reuse the supported authentication cache; keep credentials out of source, prompts and evidence. Refresh idle sessions; let active work finish before changing its session.
5. From a real worker session, negotiate MCP, discover its actual tool names, describe the expense tables and perform a read-only query. Repeat from a fresh session to verify persisted authentication. A successful CLI call or tool listing alone does not satisfy this gate.
6. Extend the capability checks with the verified Dataverse MCP requirements and rerun readiness. Missing permissions or expired authentication must produce an actionable failure.

**Exit evidence:** matching CLI/worker identities, successful MCP metadata and data reads, fresh-session verification, and passing updated readiness results. The manager's sign-in is the only unavoidable human step unless Microsoft requires additional consent.

## Phase 2 — Validate import and rehearse recovery

1. Preserve the isolated `codex/tenant-validation` changes; review the form fixes, packaging guard and prepared recovery script. Add negative tests for malformed forms and PAC errors returned with exit code zero.
2. Integrate the reviewed changes into a release branch, commit the exact source, and build/hash its package. Bind all observations to that commit and package hash. Do not label dirty-source observations as release evidence.
3. Check Development's current solution history and inventory. Identify running Microsoft imports/uninstalls. Use bounded retries with backoff only for confirmed lock failures; after a defined window (initially 30 minutes), report a blocker and the relevant operation IDs. Do not cancel Microsoft jobs, clear locks, switch environments or repeat ambiguous imports automatically.
4. Import the corrected schema package when the environment is available. Confirm success using solution history, exact installed version and component metadata. Check forms, roles, choice values, lookups and file columns; repair further platform validation failures before continuing.
5. Review and execute the prepared synthetic-record rehearsal in Development. Create only run-labelled test records; snapshot their fields, ownership, relationships and receipt bytes; inject a controlled field fault; restore from the snapshot; compare hashes; and clean up only IDs created by that run. Preserve evidence and explicitly report any failed cleanup.
6. Once the complete application exists, expand the rehearsal to cover its actual recovery procedure: application version/configuration, connection references, workflow activation and critical data. Test recovery or forward repair of an interrupted/failed deployment and rerun user journeys. A two-record field repair alone cannot certify full solution recovery.
7. Produce the release-compatible rehearsal receipt with exact source commit, environment, timestamp, runbook hash and supporting evidence. Independent QA reviews the coverage, outcome and data preservation.

**Exit evidence:** successful import with matching inventory; observed restoration/forward repair; unchanged protected data and receipts; complete cleanup results; independently reviewed recovery evidence for the complete solution.

## Phase 3 — Validate reference implementations and deliver the application

### A. Finish the Expense release

- Inventory source, open changes and actual tenant components. Identify what remains for the Canvas app, approval flow, Copilot inquiry/agent flow, security and connection references.
- Build the real Canvas application using supported authoring tools and live metadata. Resolve compiler/app-checker errors. Bind the actual Dataverse tables and verify draft editing, totals, receipt upload, duplicate submission handling and recoverable errors.
- Complete the solution-aware approval and inquiry flows, bind the verified connection IDs, validate/preflight the definitions, and include actual deployed component IDs in the solution. Verify manager resolution and caller identity enforcement.
- Package all required components and documentation. Create an immutable release with acceptance criteria and a separate QA owner.

### B. Make independent verification support the actual platform

- Add Canvas/iframe and API-only verification adapters where required. Keep authenticated origin boundaries explicit; use supported role/label locators or platform test interfaces rather than weakening the existing verifier.
- Obtain suitable existing employee and approver test identities with the intended licences and least-privilege roles. Ask for identity/access information only if discovery cannot resolve it. Administrator-only tests cannot establish employee authorization.
- Validate create/edit/submit/approve/reject/inquiry journeys, persistence across reload/sign-in, forbidden cross-user access, receipts, error handling and repeat-trigger behavior.
- Arrange test recipients before exercising notification or approval steps; do not send to unrelated users.
- Verify desktop/mobile layout, keyboard operation, loading/empty/validation/failure/recovery/success states, task timing and accessibility. Retain screenshots, traces and platform diagnostics. Independent QA must inspect the actual UI and approve all five visual scores at 4/5 or better.

### C. Prove each starter separately

| Starter | Required tenant proof |
| --- | --- |
| Canvas Apps | Supported authoring, zero compile errors, real data binding, responsive/keyboard UX and successful runtime task |
| Power Pages | Real activated reference site, intended authentication/table permissions, responsive UX and denied unauthorized access |
| Dataverse | Supported schema creation/export/import, relationship/file behavior and least-privilege data operations |
| Power Automate | Real connection resolution, platform validation, successful execution, failure handling and retry/idempotency evidence |
| Deployment | Exact package import, installed-component verification, recovery evidence and post-release health checks |

Use small isolated reference solutions/test data in the approved validation environment. Track evidence by template version, source/package hash, environment and validation time. Keep each template unverified until its own tests and independent review pass; an Expense release does not prove the unrelated Power Pages starter. Expose this evidence in the catalogue rather than changing a global boolean without provenance.

### D. Deploy, verify and hand over

1. Inspect MyDevNet's existing expense data, relationship-name mismatch and submission-date behavior. Prepare and validate a data-preserving migration or compatible forward change before any schema update there.
2. After the complete release passes Phase 2 and independent QA, deploy it to the already selected MyDevNet environment. Verify intended-user journeys against the actual deployed URLs.
3. Configure critical workflow monitoring using genuine run/health observations, plus connection and version/configuration checks. Validate healthy, degraded and recovered states without replaying transactions or sending duplicate messages.
4. Hand over the playable app/site URLs, solution/component versions, deployment record, test/visual evidence, setup/user/operations documentation and recovery runbook. Explain remaining limitations explicitly; completion requires the solution to be usable in the tenancy.

**Exit evidence:** independently verified live Expense application, individually validated starter versions, proven recovery procedure and operating health monitoring.

## Execution order and checkpoints

Start sign-in and environment-history discovery first. While waiting for human authentication or Microsoft updates, complete source review, regression tests, packaging, missing component work and verification-adapter implementation. Import/recovery depends on environment availability; final delivery depends on the complete package and independent QA.

Record progress against these checkpoints: MCP data access verified → schema import verified → schema recovery observed → complete application packaged → full recovery and independent QA passed → MyDevNet deployment verified → each starter validated and monitoring demonstrated.

Any new blocker must include the observed failure, affected target, remediation owner and next action. Do not substitute mocks, static XML checks, a maker-only login or a successful package command for tenant/runtime evidence.

Reference: [recorded validation results](TENANT-VALIDATION.md), [delivery contract](DELIVERY.md), [reliability contracts](RELIABILITY.md).
