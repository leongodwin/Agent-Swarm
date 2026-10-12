# Live application recovery and tenant validation — 12–13 October 2026

The non-Copilot CorporateExpenseManagement application passed a live forward-repair and combined-package reimport rehearsal in the separately authorized **Development** environment, `https://org68dad46d.crm4.dynamics.com` (organization `276d6f5c-20f4-46de-a631-825a64953d21`). Leon was the sole test user and email recipient. MyDevNet was not modified. Copilot Studio remained paused and no bot components were imported or exercised.

## Restoration performed

The baseline included the actual published Canvas app, server assembly, nine lifecycle safeguards, notification flow, four tables, two security roles and two connection references. The worker was stopped before exporting the unmanaged combined package and snapshotting all existing expense records and receipt bytes. The package SHA-256 was `09f38621be0ee595c5336b54774082ddae16c695a3da7b3bda702ccc4f278429`.

Run `42842f4a-b141-403e-8aff-686df8fb83e9` created disposable draft report/line/receipt fixtures and an empty team. Controlled faults changed the synthetic title, amount and receipt bytes, changed the Canvas display name and disabled one plugin step. The archived package was successfully reimported with explicit target and connection settings; customizations were published and the synthetic data and attachment were repaired using the official SDK.

Dataverse import added four Global SharePoint privileges to each expense role. The existing `Normalize-ExpenseRoles.ps1` removed only those eight additions. Both complete privilege sets and depths then exactly matched the snapshot. Recovery was not declared successful on PAC output alone.

Verification established:

- All 14 protected business records (12 pre-existing plus two rehearsal fixtures), owners, relationship references and receipt hashes matched at the restoration checkpoint. Concurrency counters were allowed to advance during repair and were not treated as recoverable business values.
- The original Canvas name/Ready status, assembly content hash, nine step states/configurations, both connection IDs/connectors and both role privilege sets/depths matched.
- The baseline and downloaded restored `.msapp` were byte-identical: SHA-256 `532a9bd4662c7800b13acd480702abad394084201e0f94f04f2385f21db499d4`, all 21 archive entries equal.
- Notification flow definition, named solution membership and resolved runtime bindings matched after activation. The worker returned to its original Started state.
- Final cleanup removed every run-owned record, temporary team and reference. All three original reports, three lines, six notifications and their receipts remained unchanged; original solution component membership remained intact.

This is full recovery of the selected non-Copilot application through **package reimport and data-preserving forward repair**. It does not demonstrate an administrator point-in-time restore of the entire Dataverse environment or recovery of unrelated solutions.

## Fresh journeys after restoration

Canvas displayed the restored GBP 4.56 report and saved receipt filename. Leon submitted it through the published Canvas app, received the assigned review, and approved it through the app with a synthetic explanation. Independent Dataverse reads confirmed both transitions, the assigned approver, persisted total and exactly one outbox event per transition.

The authenticated notification worker completed successful runs whose `List_pending` outputs identified this report. Outlook Email independently verified one matching ReviewRequired email and one matching Approved email **in Leon's Inbox**, each containing the test report and correct Development app link. A subsequent worker run had zero pending rows and skipped Send_notification; a fresh Inbox check found the same two message IDs and no extra matching messages. These are synthetic tests, not reimbursement transactions. The two test emails remain as delivery evidence.

The server regression suite passed 34 live checks, covering stale revisions, forged state/total/lock writes, required receipts, immutable submitted files/rows, idempotency, competing decisions, exclusive notification claims and uncertain sends. Its own fixtures were removed. A Windows CLI-launcher failure on the first attempt was corrected and that attempt's two draft rows were separately removed before rerunning.

## Reliability fixes discovered

Live record sharing exposed Dataverse's required `@odata.id` target format and polymorphic `ownerid` principal serialization. The adapter now handles both. One ReadAccess grant to the empty run-owned team was executed, its successful response deliberately lost, and the observed grant reconciled without another write. The grant was explicitly revoked and its absence checked.

A disposable, unbound solution connection reference exercised actual conditional binding repair using an existing connection. One ETag-protected PATCH succeeded, its response was deliberately lost, and observation reconciled it without a repeat. No new credential or connection was created; the temporary reference was removed. Clearing a working reference with null did not persist, and an invalid connection ID was rejected by Dataverse, so neither attempt was represented as a successful binding fault.

Imported stopped flows omit their resolved `connectionName` until activation. Swarm now checks approved Embedded logical references against freshly read active Dataverse reference rows before activation, then requires exact resolved runtime bindings immediately afterward. Strict runtime verification still rejects unresolved references; Invoker references cannot use this fallback. The observed post-import state exposed this issue; regression tests cover the corrected ordering.

Local verification: **450 tests passed, one existing TODO**, TypeScript validation and production build passed. The existing physics bundle size warning remains. The source-watched office reloaded and `/api/runtime` confirmed a non-demo process; persisted delivery policy still has `copilotPaused: true`. These newly discovered fixes are local commits/changes until separately pushed.

## Evidence and limits

Evidence is retained under `.swarm-reliability/recovery-2026-10-12/`: `state.json`, `baseline.zip`, `import-output.txt`, `role-normalization-output.txt`, `canvas-package-proof.json`, `flow-restore-proof.json`, `binding-repair-proof.json`, `sharing-proof.json`, `live-tests.json`, `notification-submission.json`, `notification-approval.json`, `replay-proof.json`, Canvas screenshots/DOM observations, `final-audit.json` and `recovery-receipt.json`. Authentication tokens/browser storage are not retained in these artifacts. The receipt records the source and runner commits separately; QA must review the evidence and pinned release applicability before using it at a release gate.

Remaining limits:

- The browser tool timed out waiting for the live Canvas file chooser and receipt download event, despite previously enabled extension file-URL access. SDK receipt upload/download and recovery hashes passed; those results do not prove Canvas file-transfer acceptance. A manual Canvas choose/upload/open-original test remains required.
- Leon is an administrator and uses the existing Development-only synthetic self-review override. Functional success and role metadata comparison do not establish employee/approver isolation. There are no additional licensed nominated accounts available for that test.
- Generic starter bundles retain their individual `tenantVerified: false` status. This expense application rehearsal does not validate other starter implementations, Power Pages sites or new schema/data conversions.
- Copilot Studio publication/conversation tests remain paused. No independent QA approval or production readiness is claimed.
