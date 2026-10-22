# Guarded SharePoint provisioning QA — 16 October 2026

## Implemented scope

Preserved the existing dirty checkout. Added a typed SharePoint schema service, delegated Graph transport and session-bound engineering tool. No existing tenant resources, app packages, auth profiles or permissions were changed.

Discovery/design workers may inspect exact canonical `/sites/name` metadata only. The service verifies the Graph token's actual delegated tenant/account/audience/expiry and the returned SharePoint tenant, site collection and web identities. List/library and column pagination stays on the exact collection/query with bounded bytes, rows and pages. Business records and document content are excluded.

Provisioning reads `cubefarm.sharepoint.json` only from the delivery record's pinned source commit. It requires existing independently approved design/task admission, an exact parsed plan hash in the task inputs, owned resource keys, fresh site-scoped permission/data-boundary/recovery governance evidence and unchanged configuration/session/authentication ownership. Discovery does not authorize writes.

Supported writes create new generic lists or document libraries with text, number, GBP currency and choice columns. The executor does not support lookup columns, folders, sample records, files, updates, deletion or permission changes. It does not adopt existing resources by name. These remaining schema features and app/flow deployment are separate blockers.

A global per-user site lease coordinates offices independently of SWARM_HOME. All known name conflicts are checked before the first write. Shared target history records and flushes the exact ownership marker and payload hash before dispatch. Successful writes require exact ID, marker, template, site URL and declared-column readback. Unknown outcomes retain the shared history and lease; dead process IDs never authorize automatic reclamation or retry. Independently evidenced unknown-outcome reconciliation remains unimplemented. File flushing is a pre-dispatch process-crash barrier; power-loss durability of directory metadata has not been established.

## Independent findings and repairs

Independent QA reproduced and verified fixes for four safety findings: unflushed pre-dispatch intent, cross-office repeat-write risk after an unknown outcome, unbound created-resource URLs, and inconsistent retained resource provenance. Tests also cover whole-plan conflict checks, unsupported operations, cancellation/scope drift, disconnected authority, exact column readback, pagination escape, retained unknown history and dead-owner leases. No gate or substantive coverage threshold was lowered.

## Authenticated evidence

The FlowAgent `HttpRequest` contract was discovered natively, but `invoke_operation` refused its execution with HTTP403 because it only permits dynamic metadata resolvers. The Microsoft-documented Graph list creation and column contracts were inspected instead. No new API consent or permission grant was attempted.

An explicit-tenant SharePoint-resource token was obtained but the read returned HTTP401. This path was not used for provisioning. A separate Graph read verified the actual GraspAI site and SharePoint tenant/site/web IDs. The production inventory service then passed an authenticated read-only harness in4.932seconds. Its retained evidence is `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/sharepoint-inventory-live-harness.json`. This harness is not worker execution, effective-permission proof or live write acceptance.

The reviewed office was restarted at PID18248 with eleven source/document hashes in `sharepoint-boot-source.json`. Its forced prerequisite check returned ready, then the existing Ada issue1 was resumed through the manager API for bounded read-only inventory and findings. The target remains `https://mydevnet.sharepoint.com/sites/GraspAI` in the existing GraspAI tenant; no new site was created.

## Verification and remaining evidence

Focused independent core/bootstrap tests:96passed. Final frozen whole-suite results are recorded below; build and type checking were repeated against the final source.

Live list/library creation, interruption/unknown-outcome reconciliation, schema recovery, effective allow/deny identities, licensing/DLP completeness, native Canvas publication/sharing, standard-flow runtime and application acceptance remain unverified. No release or runtime approval is implied by metadata reads, synthetic tests or the existence of a guarded write implementation.

Sources: [Graph list creation](https://learn.microsoft.com/en-us/graph/api/list-create?view=graph-rest-1.0), [column definition](https://learn.microsoft.com/en-us/graph/api/resources/columndefinition?view=graph-rest-1.0), [site identity](https://learn.microsoft.com/en-us/graph/api/site-get?view=graph-rest-1.0), [SharePoint connector](https://learn.microsoft.com/en-us/connectors/sharepointonline/).
## Unattended worker rerun and application QA boundary

Actual Ada tool/result events1330/1331 show successful use of `office.sharepoint_provisioning` for the GraspAI site. The persisted inventory receipt `planning/sharepoint-inventory/e5c7cbbd709669389c1a09fc7814e9e0d20e60df9bc7ae128b486586825d694b.json` was independently hash-verified. Native UI result previews are truncated; they do not independently reconstruct complete payload hashes. The receipt itself retains full bounded metadata.

Ada completed the existing issue1 task in approximately3minutes/12turns and saved findings. The delivery record reached revision22 and remains in discovery. No SharePoint resource or app was created. Four existing showcase issues remain open; no PR was created by this work.

The normal manager API then requested the application's assigned Sherlock review. Although the assignment response said it had started, the native worker did not perform the review: admission failed with `Worker preflight missing or invalid; owner must review .cubefarm/worker-preflight.json`. This is distinct from independent code QA, which passed. The delivery owner must provide an independently reviewed contract with actual installed skill hashes and exact verified native read-only MCP probes before application QA can proceed. No contract, tool availability or approval was invented to clear that gate.

The office was paused with zero sessions at PID18248. Immutable snapshot: `observations/20261016T140905943998Z`. Remaining work is the reviewed worker contract, missing SharePoint lookup/folder/seed and unknown-outcome reconciliation adapters, a pinned independently approved schema plan with current site-specific governance/access evidence, and native Canvas/flow deployment and runtime acceptance. These prerequisites prevent an authenticated live write/recovery test today.

The Graph transport is deployment-time administration, not a premium connector added to the demo runtime. Existing broad delegated account rights were not changed; least-privilege runtime access remains unproven.


Separate native MCP checks confirmed another prerequisite distinction: the registered `flowagent` alias closed during connection, while `swarm-flowagent` connected and its real `whoami` returned the expected Azure/token/Connectivity identities. The working server's `get_current_env` returned null. `native-qa-mcp-inventory.json` records configuration only; `native-qa-probe-contract-observation.json` records the separate live tool/schema checks. These are harness checks, not application QA execution. No guessed preflight contract or global configuration change was installed; subsequent probes must use verified native names and explicit target arguments.

The fresh whole-suite run exposed pre-existing outer-budget timeouts in Windows native handoff and full disk-backed delivery fixtures. Failed/stopped logs are preserved separately. Independent QA verified the helper/I/O paths and corrected only justified integration-test budgets. Assertions, production deadlines and the90.01%coverage gate remain unchanged; final frozen-run results are recorded separately below.


## Final frozen verification

- Full regression: **237 test files passed;4,305 tests passed;two skipped and one existing TODO**. Exit0. Branch coverage **90.11%(13,304/14,763)** exceeds the unchanged90.01%gate. Final log: `output/sharepoint-final-coverage.log`. Duration564.95seconds.
- Final build and type checking passed: `output/sharepoint-final-build.log`, `output/sharepoint-final-typecheck.log`.
- Independent focused checks passed96core/bootstrap tests,15native handoff tests and57disk-backed delivery acceptance tests. All four SharePoint safety findings were fixed and independently verified. The timeout repairs changed only justified outer integration-fixture budgets.
- Preserve historical evidence: `output/sharepoint-staging-coverage.log` passed but overlapped source/test edits; `output/sharepoint-budget-failure-coverage.log` and `output/sharepoint-integration-budget-failure.log` contain recorded pre-existing fixture timeouts and were stopped before completion. They are not represented as passing final runs. The final run started after source and tests were frozen.
- Actual worker inventory succeeded; record22 remains discovery. The application's own QA admission was blocked by the absent worker preflight file. Independent code QA is distinct from application/runtime QA. No tenant provisioning, deployment or release approval occurred.
