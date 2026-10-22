# Native write and dispatch history evidence

18 October 2026. This work preserves existing changes and the immutable denied-write claim. It does not implement or configure DLP.

The authenticated restricted-app create was rejected with403. This follow-up improves retained evidence and recovery; it does not reinterpret that rejection, empty history or a local transcript as complete provider coverage.

## Implementation

`flowProviderHistory.ts` reads the official [List Flow Runs REST API, version2024-10-01](https://learn.microsoft.com/en-us/rest/api/power-platform/powerautomate/flow-runs/list-flow-runs). The native [Admins V2 ListFlowRuns/FlowRun contract](https://learn.microsoft.com/en-us/connectors/powerplatformadminv2/) was also checked through the authenticated FlowAgent operation-metadata tool. The installed top-N summary SDK is not used by the collector.

An optional reviewed `dispatchHistory` contract pins the exact environment and unique workflow IDs. The production native adapter uses only a separately configured customer-app silent cache for the Power Platform API audience. It never signs in, grants consent, resubmits a flow, switches profiles or falls back to the summary SDK. Existing checks without a pinned scope report the missing contract before acquiring a token or querying arbitrary flows.

The reader consumes validated native continuation links on the same host, environment, workflow and API version. It refuses foreign, repeated, conflicting or filtered links, malformed summaries, duplicate/unbound runs, truncation markers, provider failures and safety-limit exhaustion. Original provider pages, extra native fields and continuation are passed to the private durable capture before requesting the next page. Public observations contain projections and hashes, not continuation values or credentials. Failure to retain a required page blocks collection.

SharePoint GetChanges similarly exposes an awaited original-page retention hook containing the native query boundaries and original response. Normal and diagnostic runners retain these pages in the owned capture. Normal targeted native QA additionally requires one exact pre-claim checkpoint. Evidence import and original-run inspection validate its binding and ordering. Historical reconciliation reuses that checkpoint; it cannot replace missing historical coverage with a newly captured head.

Independent QA also found a timing defect: recording the observation end after cleanup and sealing made the final provider snapshot appear stale even when the scan was valid. The bounded observation cutoff is now captured before the terminal scan; the terminal scan must cover it, and later cleanup does not extend the claimed interval.

## Authenticated follow-up

At18:08:17 UTC, the production adapter authenticated the original observer and reread the dedicated Projects list from the original17:54 checkpoint. Its checkpoint digest matched exactly. The original raw provider response was retained privately, with zero returned item events. The original immutable claim was unchanged; no write, flow dispatch, replay or consent operation occurred. Receipt: `output/native-history-followup-6f171872-b55f-4bf0-afe7-9095281a8849.json`.

The existing customer observer app cannot silently acquire the Power Platform API audience: Microsoft returned consent-required65001. No interactive fallback or consent grant was attempted. There is no configured history metadata for that API, no reviewed deployed workflow ID, and no Admins V2 connection in the observed environment. Filtered CloudAsset, Swarm and Cloud Asset inventory searches returned empty arrays; this is not exhaustive proof that no flow or historical dispatch exists.

## Acceptance still required

Pagination exhaustion means that all pages returned by this query were read. The FlowRun schema lacks the request RunIdentifier/trigger payload; it also does not prove retention, ingestion completeness or an authoritative end barrier. Therefore `completeDispatches`, causal correlation and full acceptance remain false even after a terminal page or204 response. [Microsoft documents default run-history retention and the need to capture history before deletion](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/flow-run-issues/missing-runs-or-triggers-history-for-a-flow).

For complete bounded evidence, the delivery owner must pin the dedicated flow ID/version, establish the observer's authorized native API access, bind supported per-run trigger details to the exact project/run identifier, and verify historical retention/visibility/end-barrier coverage. SharePoint requires corresponding operation-class and historical-window coverage; older on-premises retention descriptions are not a current SharePoint Online guarantee. Full-history and successor gates remain closed until these facts are independently verified. No premium application-data dependency has been introduced.

Architecture/task reviews remain distinct from runtime approval. A feasible bounded authoring design may specify flow creation as an output and history verification as a later hold point; it must not label missing runtime evidence ready or use an invented flow ID. The existing retained claim cannot be replayed merely to create new evidence.

## Review request, reload and delivery admission

The assigned independent reviewer was requested through the normal app review endpoint for current revision47. Its bounded review completed preflight and inspected record/evidence metadata but reached its150-second budget; it was stopped at157 seconds with no persisted decision. Receipt: `output/native-history-current47-review.json`. The latest retained model-synthesized architecture actually references revision45, not current47. No fresh architecture or task approval is claimed, and task review remains dependent on current design approval. A current draft and repaired critical discovery evidence are still prerequisites; historical evidence timestamps were not refreshed.

After independent implementation QA, graceful reload loaded the tested code at18:13:34 UTC. All47 records, manifest, current revision47 hash and native keeper identity were unchanged across reload (`output/native-history-collector-restart-verification.json`). Normal delivery admission was rerun at18:13:36 UTC and returned409, Real delivery is not enabled (`output/native-history-collector-delivery-rerun.json`). There is no policy, approved architecture/task decision, run or release. The office is paused with zero sessions/native processes. This is an admission rerun, not an executed or passed deployment test.
