# Native denied-write transport and delivery rerun — 18 October 2026

Historical checkpoint for the original distinct-user contract. The later single-licensed-user adaptation, real restricted-app sign-in and pending administrator grant are documented in [Single-user native QA](SINGLE-USER-NATIVE-QA.md); the directory/app state below describes the earlier checkpoint and is not the current inventory.

Implemented a real Graph list-item create transport in `server/productionNativeQa.ts`. Preflight and reconciliation remain read-only. Execution requires a valid run context, run/UUID correlation, server ownership, an exact approved site/list, a fresh authenticated denied identity and a delegated write scope. Missing write scope cannot be mistaken for resource-level denial. One attempt is latched before any asynchronous work; network ambiguity, non403 responses, cancellation and cleanup failures never cause a retry. Provider response content is withheld.

The fixed payload uses the pinned Projects schema: Title, RunIdentifier, RecordClass=Live and SwarmStatus=New. It does not exercise the Architect Synthesis trigger or prove the eventual Canvas submission path. Graph contract: [Create a list item](https://learn.microsoft.com/graph/api/listitem-create?view=graph-rest-1.0). No new grants, account creation or permissions changes were made.

Independent QA found a response-cleanup cancellation race. The implementation now cancels the body, handles cleanup errors safely and checks ownership/cancellation again before returning a receipt. Six targeted suites passed **200 tests**; `npm run typecheck` passed. The independent reviewer separately ran four related suites (**137 tests**, including **19** independently authored transport cases) and TypeScript checks. These are synthetic transport and local gate tests, not tenant/runtime acceptance. Independent report: `output/native-runtime-independent-qa.md`.

Authenticated read-only checks for Leon completed: `/me`, the explicitly named account, and licenseDetails each returned200, including repeated identity/license reads. This is identity and license-response evidence, not full operation-specific eligibility or denied-access acceptance. User nominated Leon again for the denied role. The existing contract requires distinct denied and observer subjects; no identity was fabricated and that requirement was not weakened. The test office has no isolated native identity cache root; the machine observer MSAL cache is a different contract from the adapter's isolated Azure CLI Graph caches. No silent copying or global-profile substitution was attempted. See `output/native-runtime-independent-prerequisites.json`.

After independent QA, the office was gracefully handed off from PID31336 to PID40692 with the updated source. All47 planning history records, the V2 manifest and current revision47 hash were retained. Restart audit: `output/native-runtime-restart-verification.json`.

At16:38:29 UTC, authenticated normal delivery admission returned **HTTP409: Real delivery is not enabled**. There are zero runs/releases, no delivery policy and no architecture/task approvals on revision47. The office was re-paused with zero sessions and zero native PIDs. Receipt: `output/native-runtime-delivery-rerun.json`. This is an admission rerun; it did not execute a tenant deployment or full end-to-end acceptance.

Remaining delivery blockers:

- A genuine denied-access identity and isolated authenticated native contexts. Leon's writer context cannot establish the current distinct-user denial assertion.
- Complete authoritative correlated write and flow-dispatch history, including interrupted/uncertain outcomes. Both completeness capabilities deliberately remainfalse; delivery's all-capabilities gate is unchanged.
- Real Canvas implementation, connected source/compile/export and runtime checks, plus exact dedicated flow/channel/conditional-claim contracts and refreshed operation-specific permissions/standard-use evidence.
- Fresh planning evidence and independent architecture/task approvals bound to the final implementation. Revision47 retains its original byte-pinned source snapshots; these are historical design inputs, not refreshed evidence for this changed transport. Update and repin them when the remaining native contract is reviewable. No old evidence expiry was extended.

Existing changes and evidence were preserved. No DLP implementation or settings were changed. No tenant mutation or actual denied-write was attempted in this turn.
