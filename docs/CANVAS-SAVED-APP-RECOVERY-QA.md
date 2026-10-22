# Saved CloudAsset Studio recovery — 18 October 2026

This report supersedes the missing-saved-app/source-sync finding in `CANVAS-EDITOR-SYNC-QA.md`. It does not supersede its unrelated delivery blockers or grant architecture, task or runtime approval.

## Verified live

- The user supplied the saved CloudAsset Studio URL. The actual app is `14e6980e-734e-4b43-a220-f5ff393095e5`, environment `Default-5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c`, account `leon@graspai.co.uk`.
- The existing browser Studio editor works, and native Canvas connect returned the matching saved app, environment and account. Native synchronization downloaded three genuine YAML files. The production CLI also completed successfully with cleanup acknowledged: `output/canvas-saved-app-live-verified.json`.
- The initial three files are retained under the receipt's unique capture directory. Independent QA hashed every file and confirmed the original direct capture matches the CLI capture.
- Bounded source preparation attached only the three existing dedicated SharePoint resources at `https://mydevnet.sharepoint.com/sites/GraspAI`: Engineering Artifacts `a08957e8-bf46-466e-b1cb-93dfdfeb9347`, Swarm Projects `2ff4739d-7ab4-48fb-a5de-c7766a6cd026`, and Swarm Run Logs `c14f4bd2-f9f7-46e7-a7b1-bb57a80dc622`. The unrelated Documents library `0197e042-91a4-4356-841e-7c804b79df22` was not selected.
- Studio has two visually identical Leon connection labels. Read-only network observation identified the first as the expired `72f1bd4cb0f44eaea28d18dcd1f3b551`; that selection was cancelled without authentication. The second issued native discovery requests through the approved healthy `shared-sharepointonl-54d3d00b`. Its actual `alltables` response supplied the exact resource IDs above.
- Studio displays all three sources under `SharePoint - leon@graspai.co.uk`. After Save, the UI states **All changes are saved**, with displayed time **18/10/2026, 14:17:16**. The app remains unpublished. Evidence: `output/canvas-saved-app-sharepoint-ui-evidence.json` and `output/canvas-saved-app-sharepoint-sources.png`.
- Native `list_data_sources` returns all three connected sources, and `get_data_source_schema` succeeds for each. Actual types include choice/lookup Record values and numeric value/token/duration fields. Full responses: `output/canvas-saved-app-source-schemas.json`.
- A separate subsequent capture at `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/canvas-bound-sources-20261018` contains the same three baseline YAML hashes. Source association metadata is not represented in these YAML files; the UI and native schema observations are separate proof of association. Unchanged YAML alone is not association proof.

No app formulas, controls, layout, schema, business records, connections, consent, sharing or publication were changed in this preparation. No compile/apply operation was executed. No DLP implementation or policy change was made. Standard Studio itself performs its own automatic checks.

## Agent Swarm changes and acceptance checks

The saved-app diagnostic now accepts a bounded unique `template-name` parameter alongside a real saved edit action/app ID; creation routes and ambiguous parameters remain blocked. It recognizes the real native saved-app connect response and compares app/environment/account, rejecting an authentication-only legacy reply.

The native synchronizer recreates its target directory. The diagnostic now pins a unique outer capture directory, permits only the inner leaf to materialize during the awaited native sync, then pins and verifies that returned leaf and files through final cleanup. Outer replacement, subsequent leaf replacement, file mutation and cancellation still fail closed. Retained stage/failure diagnostics contain safe call shapes, not raw native authentication/error payloads.

Acceptance: **40 tests passed** across `server/canvasSourceSync.test.ts` and `server/canvasSourceSyncIndependentQa.test.ts`; `npx tsc --noEmit` passed. Independent QA added adversarial tests, reviewed the final code, re-ran these checks, and reviewed the real source hashes, saved UI/resource evidence and all three schema responses. Logs: `output/canvas-saved-app-fixed-tests.log`, `output/canvas-saved-app-typecheck.log`.

The production CLI positive run verifies genuine authenticated source download and bounded client cleanup, not complete native process-tree termination or app runtime correctness.

## Delivery attempt and remaining blockers

At **13:18:29 UTC**, normal deployment admission returned **HTTP 409 — Real delivery is not enabled**. Archive: `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/canvas-saved-app-delivery-rerun/20261018T131828864391Z`; receipt: `output/canvas-saved-app-delivery-rerun.json`.

Record 43 remains unchanged: architecture unreviewed, no task reviews, no delivery policy, zero runs and zero releases. The office was returned to paused with zero worker sessions and zero office-owned native PIDs. This is a blocked admission attempt, not a completed end-to-end deployment test.

The record's old missing-editor/source/schema text is now partly stale. Reconcile it with these immutable live captures in the next substantive plan revision; preserve unverified compile/readiness findings. Do not manufacture fresh evidence by extending old timestamps. Current source contracts and record evidence also need reconciliation before fresh independent architecture/task approval.

Delivery still requires: actual app implementation and connected compile/App checker/export/runtime acceptance; trusted native QA adapter and genuine history/denied-access/cleanup evidence; the intended dedicated Teams channel and executable flow claim/recovery contracts; refreshed intended-user, operation-specific standard-use and resource-access evidence; and independent approval of the resulting current architecture/tasks/release. The Studio snapshot includes generic playback-plan warnings for each source; those are retained observations, not an authoritative entitlement determination. They do not establish either licensing failure or standard-only success.

The local authoring lease owned by **CloudAsset bounded source preparation** remains held while the user's coauthoring Studio is open. No remote unlock was forced. Before another writer starts, reconcile or transfer that lease through the supported authoring workflow; save and close the authoring session before releasing it. The browser tab has been left open for continued work.

Independent QA accepted only the bounded evidence claims above. It did not approve architecture, tasks, compilation, publication, licensing or runtime.
