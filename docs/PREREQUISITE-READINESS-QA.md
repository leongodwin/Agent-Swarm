# Prerequisite readiness repair and unattended rerun

This continues the [standard-M365 showcase test](AGENT-SWARM-M365-E2E-QA.md). Passing readiness is not deployment or application acceptance. Existing workspace changes, test-office history, resource ownership and cloud connections are preserved.

## Reproduced failure

Six instrumented read-only batches of the previous fully concurrent implementation reproduced three blocked batches: two expired during Azure token acquisition and one during the target HTTP request. The failures were deadlines, not observed licence assertion failures. The bounded diagnostics record stage, failure class and elapsed milliseconds; they never persist native stdout/stderr, tokens, HTTP bodies or raw exception text.

The evidence is retained in `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/instrumented-prerequisite-diagnostics.json`. This identifies observed failing stages, not every underlying source of Windows or network latency.

## Changes

- Start MCP/CLI readiness as one bounded group, then Microsoft identity/HTTP/PAC checks as another. Preserve configured output order, evaluate every required check and perform no automatic probe retries. Every group retains its fifteen-second deadline. Shared native reads remain scoped to one cancellation owner; independent checks cannot cancel each other.
- Acquire the explicitly requested tenant/resource token once instead of first launching a separate default-account metadata command. Check the returned tenant and actual token tenant/user claims before sending any HTTP request. Keep approved-origin checks, credential-source restrictions and redirect refusal. No authentication profile is switched.
- Persist optional, bounded, secret-free stage/classification/timing diagnostics. Deadline messages no longer appear solely as generic licence/account remedies.
- Anchor the observation's sixty-second lifetime conservatively to batch start, rather than extending early observations by the duration of later probes. Diagnostic timing changes do not change readiness decisions, coordinator fingerprints or wakeups.
- Reject probes that report success after their cancellation deadline.

## Verification boundaries

Independent QA owns tests for diagnostic redaction, expiry, cancellation/deadline classification, late completion, configuration drift, timing-only wakeups, scheduling order, complete failed-check evidence, absence of hidden retries, exact token acquisition and rejection of wrong/missing token identities before HTTP.

The first scheduling-only revision passed six production-service batches and three authenticated office API batches, but the resumed coordinator subsequently encountered another target HTTP deadline. That revision alone did not resolve the intermittent problem. The subsequent single-token revision passed six fresh production-service batches; actual-office rerun results are recorded separately below when observed. Production-service diagnostic harness results are not application deployment evidence.

Three existing native integration tests exceeded their outer fixture budgets during the first full regression attempt. Independent QA increased only those test budgets to account for real Git/mutex helper startup and durable I/O, preserved every assertion and production deadline, and passed the three targeted cases. The original failed run is retained. The coverage threshold remains 90.01%.

## Remaining delivery scope

SharePoint schema/permissions observation, SharePoint-backed Canvas package inventory, typed SharePoint deployment/recovery, Canvas publish/share and comprehensive governance remain separate delivery work. No empty-Dataverse-package or API-only exception can approve this UI application. A finished Canvas app, real flows, persistence, denied/error/duplicate cases, actual evidence download and independent runtime acceptance are still required.

Coordinator/synthesis and pre-admission work remain outside the retained-task usage ledger. No complete token total or token-savings claim is made.

## Readiness-only verified results before the metadata extension

The stable full regression run passed **231 files / 4,155 tests**, with two skips and one TODO. Branch coverage is **90.03% (12,915/14,345)** against the unchanged **90.01%** gate. Build, typecheck and 91 focused prerequisite tests passed. Logs: `output/prerequisite-final-coverage.log`, `output/prerequisite-final-build.log`, `output/prerequisite-final-typecheck.log` and `output/prerequisite-final-focused.log`. Independent QA additionally passed the three native fixture cases with their corrected outer budgets. The earlier complete full run exited1 with three outer timeout failures; its final stacks and summary are retained in `output/prerequisite-staging-coverage.log`.

The owned office was drained through authenticated APIs; its owned read-only sessions were stopped, native cleanup reached zero occupied sessions, and SIGINT completed normal shutdown. No state or lease was deleted. The latest revision booted as PID56192 at the same test-home/port. `single-token-boot-source.json` captures the two changed resident module hashes; independent QA matched them to current source.

Three forced authenticated checks through that latest resident office passed all twelve checks: **9.609, 9.500 and 9.610 seconds**. These are observed cold/warm timings, not a controlled performance benchmark or guarantee of permanent readiness. The latest observed coordinator admission also passed, with no readiness blocker.

The unattended rerun advanced from `not-started` to **discovery**, created a real shared delivery record, pinned repository evidence and dispatched existing discovery tasks. The independently checked snapshot was revision4 with the coordinator and Linus working. This is progress beyond the previous attempt, not design approval, implementation or deployment.

The live rerun also exposed scope-edit sequencing: a coordinator change after Ada's dispatch invalidated her older discovery authority. The guard correctly refused stale execution. The coordinator was instructed to finish scope edits before dispatch and preserve scope while discovery runs; that operational correction is not a new code-level concurrency fix. Read-only workers also lack exact reviewed platform MCP discovery probes; ordinary read tools do not grant shell or authoring authority. Those limitations remain explicit blockers rather than reasons to weaken the guards.

## Scoped read-only platform metadata extension

`server/platformDiscovery.ts` and the engineering `office.platform_discovery` tool add an explicit alternative to blocked generic shell/MCP attempts. Discovery/design workers may request identity, environment metadata, the SharePoint site catalogue, or operation metadata for SharePoint, Teams and Approvals. This does not allow arbitrary connector execution, flow creation, site/list creation, business-record/document reads, permission changes, app publication or approval.

The broker derives exact reviewed tenant/account and WhoAmI bindings from the project configuration. It validates the actual PAC target/user/organization and any explicitly approved environment ID, plus FlowAgent's Azure/token/effective connection identities. Fixed identity reads overlap, but both must pass before metadata dispatch. A final FlowAgent identity check, scope/configuration/session guards and durable authentication-ownership fingerprint checks remain required. Both identity branches settle and the transport closes before any receipt is published, including failed or cancelled calls.

SharePoint site discovery uses only the natively verified `GetDataSets` resolver with empty parameters. The configured connection must be unique, bound to this target/account, and actually Connected for that same ID/account/connector. Caller-selected environment IDs, connection IDs, commands, URLs, tool names and resolver parameters are refused. There is no account/profile switch or automatic retry. The forty-five-second metadata deadline is separate from the unchanged fifteen-second prerequisite deadlines.

Receipts retain reviewed configuration/binding, request, observation/expiry, bounded metadata, limitations and an exact SHA256. Known credential-bearing fields and provider cache paths are withheld. These are metadata observations, not effective-access or runtime sign-off.

Independent QA found and verified fixes for legacy Dataverse GUID validation, incomplete credential-key redaction and replacement of an explicitly approved environment ID. Its broker/wiring tests also cover input refusal, exact connection/operation binding, scope drift, cancellation, parallel completion orders, late connection cleanup and secret-free bounded receipts.

The sequential prototype passed identity and connector metadata but exceeded its deadline during a second PAC connection lookup. That failed evidence is preserved. The revised broker passed three genuine authenticated harness calls: identity33.418s, SharePoint sites43.531s, connector operation index34.828s. They are harness checks, not proof that an admitted application worker used the tool. The latest office boot at PID31632 retains its own five-module source manifest in `platform-discovery-boot-source.json`; the actual worker rerun and final regression are recorded when complete.

The driver also corrected its own restart-resumption sequence: stopping Ada for maintenance required reassignment through the normal manager API. The coordinator has no manager assignment tool. That intervention is recorded and must not be represented as independent coordinator reassignment or an Agent Swarm defect.

The real admitted Ada session then used the broker and saved returned evidence into the shared record. Events1150/1153 show the SharePoint site read/result; event1155 saved a finding and the record advanced to revision16. Subsequent environment and identity metadata reads and repository observation advanced it to revision19. These observations prove scoped metadata discovery, not licensing/DLP completeness, effective permissions, provisioning or a deployed app. Metadata receipts expire after sixty seconds and require refresh before any decision that needs current evidence.

## Bounded source reading

The rerun found that read-only native Codex workers lacked a usable approved source reader: shell and generic MCP workarounds were correctly denied. `office.read_delivery_source` now exposes six enumerated office documents and exact regular non-executable blobs at the repository's pinned source commit. Repository reads use the existing isolated raw Git grammar; caller-supplied commit IDs, arbitrary filesystem paths and execution are unavailable. Reads are limited to256KiB source,120 lines/page and24KiB returned text. A caller can pin further pages to the returned full-content hash. NUL-bearing content, traversal, unknown fields, stale page hashes and scope/session/source changes are rejected. Engineering and independent QA receive this read-only tool without authoring or approval gains.

Independent tests cover the reader, its engineering/QA session boundaries and bootstrap wiring. The final real office boot is PID34588 with six resident source hashes in `delivery-source-boot-source.json`. Its authenticated prerequisite check passed before the existing Linus issue2 was resumed through the manager API. The admitted worker successfully read DELIVERY, FIRST-SLICE, APPLICATION-SPECIFICATION, QUALITY-EVIDENCE and the pinned README at commit `a606bad817462141aa3c497ab59887f4aebe365f`; later DELIVERY pages included the expected hash. These are actual tool/result events, not a parent-generated substitute for worker execution.

The final combined regression passed: 234 test files, 4,231 tests passed, two skipped and one existing TODO. Branch coverage is 90.08% (13,085/14,525), exceeding the unchanged 90.01% gate. Build and type checking passed. Logs: `output/discovery-final-coverage.log`, `output/discovery-final-build.log`, `output/discovery-final-typecheck.log`.

The unattended rerun reached discovery and both workers finished. The office was paused with zero active sessions after completion. No showcase app, SharePoint structures or flows have been deployed. Remaining blockers include typed SharePoint inventory/provisioning and governance/recovery contracts; supported Canvas export, publish and sharing contracts; current licensing/DLP and effective-access evidence; and independent runtime acceptance. Successful read-only metadata/source results do not satisfy those gates. Native UI log result previews are truncated; platform receipt files are independently hash-verifiable, but those previews alone cannot verify complete source-reader result payload hashes.
