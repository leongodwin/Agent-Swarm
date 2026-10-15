# Tenant readiness and validation — 13 October 2026

## Current scope — 15 October 2026

The [reference-only backend pilot](BACKEND-PILOT-COMPLETION.md) is now deployed and independently accepted, including its shared slice receipt. It used the separately approved MyDevNet development target and existing-licence manual controls. This does not supersede the full-app gaps below: current UI receipt acceptance, intended-user isolation, integrated flows and production assurance remain open. Copilot remains paused. See [current status](PRODUCTION-GOAL-STATUS.md). All process states, authentication observations and “current/latest” headings below describe dated historical checkpoints; recheck them before action.

## Current checkpoint — 13 October 2026

The combined non-Copilot expense application passed a live package reimport and data-preserving forward-repair rehearsal in the authorized Development test environment. Canvas submission/approval, independent Dataverse persistence, two independently received Inbox notifications, replay without duplicate sends, and 34 live server regression checks passed. All run-owned tenant fixtures were cleaned up and all pre-existing data/receipts and component membership preserved. The worker is Started; Copilot Studio remains paused.

See [the current recovery validation report](RECOVERY-VALIDATION-2026-10-13.md) and [runbook](EXPENSE-RECOVERY-RUNBOOK.md). Earlier checkpoint statements below are historical where superseded. Canvas file chooser/download acceptance, separate licensed intended-role isolation, individual starter tenant proofs and independent QA approval remain incomplete. This was application forward repair, not an administrator point-in-time environment restore.

## Previous backend/reload checkpoint

API-only acceptance and bounded connection-repair, record-sharing, schema-contract and local Canvas ownership adapters are implemented. Runner-owned MyDevNet read assertions, table/schema mapping and no-op binding reconciliation passed. The live non-demo office was reloaded and its ownership-conflict, restart recovery and persisted Copilot pause checked. Grace's surviving Copilot task is stopped; other workers remain attached. Detailed scope, tests and remaining tenant-mutation boundaries are in [the 12 October report](RELIABILITY-VALIDATION-2026-10-12.md). This supersedes the older statement that these adapters are all pending; it does not complete the Canvas picker test, role isolation, general data migrations or full application recovery.

## Current scope and checkpoint

Copilot Studio integration is paused at Leon's request because additional capacity is outside the current budget. Its pending connection approval is not a request to resume development. No Copilot publication, conversation, capacity purchase or Copilot-specific status-flow invocation was performed in this batch. The older statement below that the status flow is absent is historical; it was subsequently deployed, while published conversation acceptance remains incomplete and paused.

The current Agent Swarm batch adds exact target connection-reference checks and checks deployed flow bindings against them before activation and during verification. Read-only MyDevNet proof passed for both Dataverse and Outlook references inside CorporateExpenseManagement, and for the notification worker's actual runtime bindings. Fresh Dataverse regression passed 11 checks with all nine safeguards active and no synthetic approval exceptions. Mandatory receipts, stale updates, forged state/total writes and ordinary self-approval without an eligible manager were rejected; failed submissions remained Draft and produced no notification. Both newly created draft fixtures were deleted normally, without bypassing plug-ins.

The published Canvas app loaded under Leon's account and displayed the saved report, expense amounts and missing-receipt state correctly. Its Choose receipt control and actual file input both failed to expose a chooser event to browser automation. A manual upload request is pending. SDK receipt upload passed independently and does not certify Canvas upload. Recent scheduled notification-worker runs succeeded; these were health observations, not fresh delivery of approval emails. Earlier end-to-end submission, decision, receipt-download and email results remain dated historical evidence.

Evidence and exact limitations are recorded in [the current batch report](RELIABILITY-VALIDATION-2026-10-11.md). Single-administrator testing cannot certify least-privilege employee/approver isolation. Starter-specific tenant validation, broad application recovery, API-only independent acceptance, automatic sharing/schema/connection repair and Studio ownership adapters remain open.

## Latest validation: cloud flows and Copilot

The 10 October evening MyDevNet checks verified the synthetic notification worker, server submission/approval, two delivered notifications and replay exclusion. The expense Copilot was imported, published and installed in Leon's Teams account with his approval. Its published conversation returned a usage-limit error; conversation acceptance remains blocked, and the referenced status flow is absent. See [the detailed results and remaining work](MYDEVNET-FLOW-COPILOT-VALIDATION.md).

The notes below are chronological history. Earlier statements about incomplete imports, blank Canvas apps or missing authentication describe those earlier checkpoints and are superseded by later dated results where applicable.

## Earlier verified progress

Dataverse MCP access passed after the Codex restart: native MCP search found both Expense tables, describe returned their schemas, and read_query returned zero rows for each table in MyDevNet. All 16 live readiness checks passed at 2026-10-10 00:35:27 UTC. Windows interactive authentication resolved the device-code policy block without policy changes.

CorporateExpenseManagement 1.0.0.0 imported successfully into Development at 00:35:45 UTC and publishing completed at 00:36:29 UTC. Solution history reports success and inventory confirms solution ID `79c32e18-7d1c-416a-8e13-ed0ce78b43d6` and both expense tables. Imported package SHA-256: `3F0F3D305FF9662362101D3CA713F6C3C26399BE92646FA6A66F6F572DEB8C17`.

The reviewed Expense fixes were committed locally on `codex/tenant-validation` (`6423b97552fbf8bea202ca38ffa6603c5c76081b`). Four Python regression tests, PAC error-wrapper tests, Microsoft FormXml schema validation and packaging passed. A live receipt-upload failure was then corrected in `4da3581946cb17373139ff348403a09fa8f0c7a8` by using binary upload media type. Neither commit has been pushed or merged.

The synthetic field-repair rehearsal passed against that clean latter commit: `restored`, `dataPreserved` and `cleanup` are all true, and protected record/receipt hashes match. The first failed attempt also cleaned up its records. Evidence: `C:/temp/cubefarm/.swarm-reliability/expense-validation/artifacts/recovery-binary/`. This is a two-record schema rehearsal, not full application recovery or independent QA approval.

A blank Canvas app was saved in Development as **Corporate Expense Management — Validation**, app ID `a992b179-80a9-453a-86a0-f3c036fd477b`. The user joined Studio. Canvas connection authenticates successfully; data binding, synchronization and implementation remain in progress. The only nominated test identity and synthetic approval recipient is `leon@graspai.co.uk`, whose maker/admin privileges cannot establish employee/approver isolation.

Canvas follow-up: saved-app synchronization succeeded with three YAML files. The user added Expense Reports, Expense Line Items and Users; MCP verified all three native Dataverse bindings and retrieved their actual schemas. The user confirmed GBP amounts and receipts required for every expense. The Copilot policy source and generated files were updated and consistency checks passed in Expense commit `380a182`. Submission enforcement and runtime tests remain to be implemented; policy text alone is not enforcement.

Development flow readiness: an Expense flow search returned none, and Dataverse/Approvals connection searches returned none. Created Connected test-environment connections `shared-commondataser-1f72b56f` and `shared-approvals-69aa3963`. No flow was enabled and no approval sent. Expense `APPLICATION-CONTRACTS.md` records missing server-authorized, idempotent submission/decision operations, assignment/outbox persistence, lifecycle/file guards and role-verification requirements. The four-screen experience has been revised for bounded scrolling of unbounded datasets. Canvas implementation remains pending these feasibility gaps and the skill's experience approval gate; the saved app is still blank.

## Earlier observations (superseded where updated above)

The live office at `http://localhost:5317` has a persisted capability configuration for `leongodwin/Expnese-App2`. All 15 checks passed at 2026-10-10 00:05 UTC: GitHub, worker CLI, maker identity, Dataverse organization/user, Power Apps Premium and its Dataverse/in-app Flow service plans, Exchange Online, PAC, private .NET 10, Canvas and FlowAgent MCP negotiation, and four connector connections. This is authoring readiness for the maker; it does not establish end-user permissions or finished-application behavior.

Deployment target: `https://org0efd6060.crm4.dynamics.com` (MyDevNet default).
Approved rehearsal target: `https://org68dad46d.crm4.dynamics.com` (Development).
Tenant: `5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c`; maker: `leon@graspai.co.uk`.

Created and verified Connected:

| Connector | Connection ID |
| --- | --- |
| Dataverse | `shared-commondataser-874da412` |
| Approvals | `shared-approvals-a1529bb7` |
| Office 365 Users | `shared-office365user-7d7cc2ff` |
| Office 365 Outlook | `shared-office365-95645b6e` |

Existing connections were left intact. FlowAgent's effective connectivity identity and Azure identity both matched the maker and tenant. Checks pin these exact connection IDs; Approvals displays `Standard approvals` rather than a user name. No approval request or email was sent. The final application must bind these IDs to its actual solution connection references.

The installed FlowAgent server successfully returned the tenant's environments. It is registered as `swarm-flowagent` for new Codex sessions. Canvas Authoring successfully negotiated and exposed compile, synchronization, accessibility and app-checker tools. Its authenticated app authoring session has not been verified. The Dataverse CLI and Python SDK prerequisites were installed. Dataverse CLI device-code sign-in was blocked by Conditional Access (`53003`) at 2026-10-10 00:20:52 UTC after successful authentication. The specific policy is not yet identified. See [administrator diagnostic details](DATAVERSE-AUTH-BLOCKER.md).

The office now refreshes credentials through the existing Azure CLI sign-in without storing tokens in its configuration, and matches licence SKU/service-plan status within the same observed record. See [reliability configuration](RELIABILITY.md).

## Defects found by live validation

The pinned Expense source was `9abf1378ac9d1e14b3f0c2d2414fdff89193ce3c`. Its local Python validation and PAC packaging passed, but the real Dataverse import rejected the main forms:

- Unsupported `showheader`, `showfooter` and `headerdensity` form attributes.
- Empty header/footer, events and form-library elements that lack mandatory children.

These are corrected in an isolated local Expense worktree on `codex/tenant-validation` at `C:/temp/cubefarm/.swarm-reliability/expense-validation`. Changes are uncommitted and have not been pushed or merged. The checkout also adds `scripts/Validate-FormXml.ps1`, invokes it during packaging, and extends the Python regression guards. Both corrected forms pass the [official Microsoft FormXml schema](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/form-xml-schema). The schema download is hash-pinned and cached under ignored `artifacts/form-schemas`; the first build requires access to Microsoft's download host. Server import is still required because the published schema is not a complete current-platform validation.

PAC 2.11.2 printed import errors while returning exit code zero. The office now rejects PAC stdout containing an `Error:` line, so a failed import cannot silently advance its checkpoint. The private .NET executable-path resolver and PAC's single-space separator after long connector API names were also corrected.

## Still incomplete

Microsoft-managed updates are repeatedly importing/uninstalling solutions in Development. The original import attempts were rejected by the environment lock. After an interval of completed updates, imports reached server validation and exposed the form defects above. A subsequent corrected-form import passed that stage but rejected the Expense Submitter role: `prvAppendToUser` cannot have Basic depth. Live privilege metadata confirms both `prvAppendToUser` and `prvReadUser` disallow Basic and allow Local, Deep and Global. The isolated source now uses Local, the narrowest supported depth, for these two system-user privileges. Expense record privileges remain Basic. Local user access covers the business unit and requires role-level tenant validation. No successful Expense import, recovery rehearsal, or complete application deployment has been established.

The isolated worktree contains a prepared `scripts/rehearse-recovery.py`. It is **not yet executed or validated**. Its scope is deliberately limited to two newly created synthetic draft expense records: inject a field fault, repair those fields, compare row/owner/relationship/receipt hashes, and delete only its own test IDs. It is not an environment restore or evidence of full application recovery. Any resulting observation must be independently reviewed; dirty-source observations cannot be promoted as evidence for an immutable release.

Remaining sequence:

1. Dataverse CLI Windows sign-in is now verified as the expected maker, tenant and organization. The failed policy was Microsoft-managed device-code blocking; MFA succeeded. The MCP client was enabled for MyDevNet and `dataverse-org0efd6060` registered globally in Codex. Restart Codex, then verify real Dataverse MCP metadata and data access from the fresh session; this final check remains pending.
2. Wait for Microsoft-managed solution operations to finish; import the corrected package into Development and verify solution/component inventory.
3. Execute and inspect the schema recovery rehearsal; fix any problems before promoting its evidence. Validate broader recovery once the actual app, flow and Copilot components are packaged.
4. Finish and package the real Canvas app/approval flow/Copilot solution. The current package contains schema and roles only; the tenant flow search returned no Expense flow. All five generic starter bundles remain `tenantVerified: false`.
5. Supply intended-role test identities, complete independent runtime/visual checks, and configure critical workflow probes from actual successful workflow observations. No synthetic passing health data was created.

## Verification of office changes

393 tests passed, one pre-existing TODO; typecheck, production build and isolated packaged-install smoke test passed. Live readiness was independently refreshed through the office API. Raw local observations/configuration are retained under `C:/temp/cubefarm/.swarm-reliability/`; authentication tokens and browser storage states are not evidence artifacts.
