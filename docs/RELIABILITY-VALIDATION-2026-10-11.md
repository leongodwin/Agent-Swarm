# Agent Swarm reliability and MyDevNet validation — 11 October 2026

## Implemented

- Added `connection-reference` target mapping with exact named-solution membership and unambiguous logical-name lookup.
- Added typed `connection-reference-check` actions pinned to expected connector and connection IDs. Declared references require a check. Missing/inactive/mismatched bindings block deployment verification; drift invalidates earlier verified journal entries. No permissions or connections are changed automatically.
- Added runtime flow binding verification: every connector dependency must match a declared reference and its approved binding. Checks run before activation and during verification. Reference checks execute before activation even when the manifest lists them afterwards. A flow stop remains available without the activation binding check.
- Added regression coverage for wrong connector/connection, missing membership, missing approval, inactive reference, ownership loss, drift, recovery after a corrected binding, changed release contract and activation ordering. No Copilot integration changes.

The connection fields use [Microsoft's documented Dataverse contract](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/connectionreference).

## Current tenant evidence

Target: MyDevNet, `https://org0efd6060.crm4.dynamics.com`. Caller: `leon@graspai.co.uk`. Organization `e9c89f1b-9270-47e3-83f3-1cb2547a0354`, caller `48dd0213-f2f6-eb11-94ee-000d3a4bf7a5` verified live.

| Area | Observed result | Limit |
| --- | --- | --- |
| Dataverse safeguards | Nine active steps; dispatcher configuration only; no temporary self-approval overrides | Administrator account |
| Fresh server regression | Eleven checks passed; mandatory receipt, stale revision, forged total/status and ineligible manager blocked; failed submissions preserved Draft/total and produced no notification | Does not exercise successful approval with separate roles |
| Synthetic cleanup | New report and expense removed through ordinary SDK deletes | No plug-in bypass or policy change |
| Receipt storage | Synthetic SDK upload persisted its filename; fixture hash retained | Does not prove Canvas chooser/upload |
| Connection adapter | Live Dataverse and Outlook logical names resolved inside CorporateExpenseManagement; approved active binding values matched | Reference matching does not prove credentials |
| Runtime flow bindings | Notification worker's two dependencies matched the same approved bindings | Read-only observation |
| Power Automate health | Five recent notification-worker runs succeeded | Scheduled/empty-queue success is not a fresh email-delivery test |
| Published Canvas | Signed-in app loaded; saved report/expenses displayed; missing receipt correctly shown and Upload disabled before selection | Browser file-picker event unavailable; manual upload pending |
| Copilot Studio | Paused; no publication/conversation/status-flow tests run | User budget constraint |

Evidence files:

- `.swarm-reliability/expense-validation/artifacts/mydevnet/reliability-regression.json` — fresh server checks, observed rejection messages and cleanup.
- `.swarm-reliability/platform-validation/connection-binding-verification.json` — new adapters against actual MyDevNet reference rows and runtime flow definitions.
- `.swarm-reliability/platform-validation/notification-worker-health.json` — five current scheduled-run health observations.
- `.swarm-reliability/platform-validation/canvas-receipt-validation.png` — published Canvas checkpoint awaiting manual upload.
- Reproducible guarded scripts: `expense-validation/scripts/mydevnet-regression.py` and `platform-validation/verify-bindings.ts` below `.swarm-reliability/`.

The earlier MyDevNet functional submission/approval/rejection and notification delivery evidence remains in `expense-validation/CanvasApps/MYDEVNET-VALIDATION.md`. It was not repeated with a synthetic policy override in this batch.

## Validation and remaining work

Baseline: 46 test files, 433 tests passed and one existing TODO. Final focused validation: 50 tests passed across the four changed adapter/lifecycle/release-runner test files; TypeScript validation and production build pass. The build retains the pre-existing large physics bundle warning. Changes are local; a build does not prove the running server has loaded them.

Remaining: finish manual Canvas receipt selection/upload and readback; least-privilege employee/approver acceptance requires suitable separate licensed accounts; individual starter tenant proofs and full application recovery remain unverified. Independent API-only release acceptance, supported schema migration/sharing/connection repair and Studio ownership adapters remain implementation work. Copilot Studio stays paused. This batch is not a claim that all reliability-plan phases or production acceptance are complete.
