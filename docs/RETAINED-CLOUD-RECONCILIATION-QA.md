# Retained cloud-operation reconciliation

15 October 2026. This follow-up preserves existing repository changes and the earlier empty-history recovery/adoption implementation. The new path is **read-only reconciliation evidence**. It does not release a deployment/target lease, resume a delivery, unblock authoring or grant QA approval.

## Implemented contract

`GET /api/delivery/recovery` now exposes a snapshot hash and `retainedInspectionAvailable` for validated retained history with an absent local owner. `canRecover` retains its original zero-cloud-history meaning. A retained inspection flag is not takeover authorization.

Authenticated `POST /api/delivery/recovery/retained` accepts only `{snapshotSha256, targets}`. Each target contains its HTTPS environment root, expected `{organizationId,userId}` binding and expected `{tenantId,environmentId,username}` identity. Those are expectations, never caller-supplied observation results. Organization/user must match the immutable approved API release binding; the provider must independently verify the actual identity. No command, query, observation, force flag or mutation body is accepted from the caller.

The office must already be in maintenance, delivery must be unavailable, and authentication ownership must remain clear. A single bounded reconciliation shares the existing recovery exclusion. Shutdown and a two-minute deadline abort native reads; results arriving after cancellation or ownership/history changes cannot finalize an audit.

Supported retained records are strictly attributed imports: an approved matching release/run/target, pinned package digest, solution name, `import-started` or `imported` checkpoint, and one `solution-import` operation with its exact recorded platform job GUID. Missing job IDs, legacy/missing journals, unsupported post-deploy actions, unlinked attempts, duplicate job identities or unpinned target identities remain blocked. Up to ten exact targets and fifty imports are allowed. All retained operations must fit the supported scope; partial observations cannot authorize a subset takeover.

The production observer uses the installed Dataverse CLI and the existing identity verifier. It invokes only `dataverse auth who` and fixed `GET` resources: `WhoAmI`, `RetrieveCurrentOrganization`, and the exact `importjobs(<recorded-guid>)` with five selected fields. It does not run repository scripts, import/publish commands, arbitrary caller queries or a mutation callback. The installed CLI's `api request --help` contract was checked locally (`output/cloud-recovery-cli-contract.log`). Microsoft's [ImportJob reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/importjob) documents the GUID, solution name, progress and read-only start/completion fields used here.

Two passes must observe the same job identity, solution, 100% progress and consistent nonfuture completion timestamps after the recorded local intent. The authenticated organization/user/tenant/environment/account is freshly checked before and after each pass. A terminal observation says the recorded job finished; it does not establish import success, complete side effects, package attribution or deployed-app correctness. Strict timestamp checks deliberately block clock-skew ambiguity rather than guessing.

## Evidence and preserved holds

The runner records exact target expectations, fresh identity receipts, operation/run/command bindings, two terminal observations and the original snapshot hash. It archives byte-for-byte copies of the original state and ownership marker. A receipt is staged and flushed, then published only after the final snapshot/authorization check. Failed or interrupted staging remains uncommitted evidence.

The live deployment marker, state, operation statuses, checkpoints, immutable release contracts, approval decisions, attempt history and resource leases remain unchanged. Receipts explicitly say `deliveryLeaseReleased:false`, `resourceLeasesReleased:false`, `deploymentOutcomeVerified:false` and `releaseApproved:false`. Delivery remains unavailable and maintenance cannot be lifted by this endpoint. The existing empty-history recovery and durable native-job holds remain separate.

## Acceptance and independent QA

Tests exercise the authenticated HTTP gate and the production service observer with synthetic CLI responses, plus adversarial independent module acceptance. They cover missing/foreign identities, invalid targets, unsupported history, missing/duplicate job IDs, pending/future/drifting observations, changed snapshots, concurrency, cancellation, native read deadlines, partial audit writes and byte-for-byte preservation of all ownership/history markers. These are local/synthetic checks, not authenticated tenant evidence.

Independent QA passed **89 tests across three suites**, including 32 adversarial reconciliation cases. Findings fixed: stable terminal observations across passes, retained identity evidence, staged audit publication after final authorization/snapshot checks, and rejection of non-root stored targets. Service tests exercise fixed native CLI read arguments, cancellation/deadline abort and unchanged deployment holds. HTTP tests cover authentication, strict request input, maintenance and changing authentication ownership.

The final serial whole-backend coverage run exited zero: **204 files passed; 3,905 tests passed, two Unix-only skips and one existing TODO**. Backend branch coverage is **90.11% (12,282/13,629)** against the unchanged **90.01%** threshold; the new observation module covers 66 of 73 branches (90.41%). No coverage exclusions, test deadlines or thresholds were weakened. All five production hashes in `output/cloud-recovery-source-freeze.json` remained unchanged at completion.

Typecheck, production build, Chromium execution-efficiency acceptance (one test, isolated port 4497) and package install/version/demo smoke (isolated port 4496) passed. The existing client chunk-size warning remains. A pre-existing self-referential negative-test fixture needed explicit return annotations to pass typecheck; no test behavior was changed. Evidence: `output/cloud-recovery-coverage.log`, `output/cloud-recovery-typecheck.log`, `output/cloud-recovery-build.log`, `output/cloud-recovery-e2e.log`, `output/cloud-recovery-package.log`, `output/cloud-recovery-service.log` and `output/cloud-recovery-whitespace.log`.

No live office was restarted, and no tenant or model work was dispatched for these tests. The environment/release owner must provide an approved target and attributable retained job for live verification; the runtime owner must implement a separately reviewed native-exit/target-lease handoff before takeover/resumption can be enabled. Independent QA must verify that real timeline and the resumed delivery outcome.

## Still needs live evidence

1. An approved environment and retained run with a genuinely recorded import job ID: authenticated success and refusal cases for completed, running, missing, failed/partial and inaccessible jobs, including identity mismatch, cancellation and read failures. Synthetic responses do not certify the tenant contract.
2. Independent proof that inherited native commands and target-resource leases have stopped safely. A dead server and terminal import record are insufficient; this is why takeover remains blocked.
3. A separately reviewed release/resume workflow after that proof, including failed-import side effects, current target state, verification and independent QA. This endpoint never retries an operation or approves its outcome.

Imports interrupted before PAC returns often lack a durable platform job ID in the current journal. They remain explicit blockers; matching installed solution versions cannot repair that attribution gap. Unsupported post-deploy operations, UI-only releases lacking a pinned API binding and legacy history require additional typed observers/independent reconciliation rather than editing approved history.

The [native-command and target-lease follow-up](NATIVE-TARGET-RECONCILIATION-QA.md) adds exact native journal fingerprints and guarded resource inventory. These observations preserve all resumption holds.
