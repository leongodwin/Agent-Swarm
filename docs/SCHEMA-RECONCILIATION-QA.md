# Owned SharePoint schema reconciliation — 18 October 2026

This change addresses the retained first-parent intent from the failed CloudAsset schema readback. It preserves the existing list and all previous work; DLP implementation is excluded.

## Contract

`sharepointReconciliation.ts` supports only the explicit original-to-revised text-facet migration. It binds the original committed plan, byte-exact failed journal/lease and hashes, original operation marker/payload, actual resource ID, full metadata snapshot, old owner and new record/task/plan/authority. Other schema or target changes are rejected.

The original owner process must be absent. Two fresh read-only inventories must match the reviewed metadata exactly. The reconciler never sends a remote mutation and never adopts by name. The original marker remains intact; the new verified entry carries a lineage reference and revised payload digest. The ordinary executor verifies that lineage and rereads the parent before using its ID in the child lookup.

Handoff takes the same `.reaping` guard used by acquisition/release. A fsynced pending receipt archives original snapshots before publishing the new journal and current-process lease. There is no cleared-lease window. Applied lineage is hash-bound through its `binding`; phase and publication snapshots are local handoff status data. Any error/crash after pending publication retains blocking state for independent recovery, without rollback over a successor or automatic replay.

Fresh operator approval must name exactly `reconcile-owned-schema` and `create-schema`; ordinary create-only authority cannot authorize reconciliation. Assigned independent application QA reviews the complete current proposal, including the migration. Global design/task acceptance and release gates are not upgraded.

## Source and tests

The source adds the reconciler, transferred-lease acceptance and verified lineage in provisioning. Bootstrap review/runtime includes reconciliation and its original pinned source in the proposal. A per-request cache avoids repeatedly launching Git for immutable committed blobs; mutable code/configuration/evidence/approval is rechecked on every authorization.

The focused eight-file suite passed **155 tests**, including **19 independent reconciliation tests**, and TypeScript checks passed. Cases cover live owner, altered snapshots/schema/marker/plan, guard revocation, lineage tampering, all handoff crash checkpoints, no parent replay, exact child lookup binding and operator-scope separation. These are synthetic contract/fault tests, not a live forced-crash rehearsal.

Independent source QA found no blocking findings. Its final review confirmed that record 39 changes only the pinned source, task 5's revised inputs/stop condition and a supporting finding; existing global blockers and approvals remain unchanged.

The local showcase source is `ab005dafc39d898b527ad522545b5414b6aff3a9`, with revised plan `5abd1e7c88d94d9224c656ff37eb243a95b8f00e04c56312a58b760183d5ccfc`. No push was performed.

## Fresh preparation evidence

Old office PID 17964 was gracefully stopped after observing zero sessions and no owned native PIDs. Current OS liveness checks found it absent. Its original journal and lease were archived byte-for-byte before changes:

- Journal SHA256: `ad609037bebf070feb5e08d7f01235f1957099d39a7ffedde0ebf6438cbdc54c`
- Lease SHA256: `ea084be1b2bb1b244513aaedf483e5302d5614adda875b92ef090c3ad99213d7`
- Owned Projects ID: `2ff4739d-7ab4-48fb-a5de-c7766a6cd026`
- Fresh reviewed metadata SHA256: `119ac754bf2a03d5d5903ab4455227b5c325f9198d074f81a8843e68b36018f7`

Preparation made only authenticated read-only provider calls. The operator assertion is separate from independent QA approval. Execution must recheck these facts; PID absence alone does not establish remote completion.

Evidence is retained under `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/schema-reconciliation-run/20261018T100409887282Z/`. Assigned application review and execution have separate timestamped `schema-reconciliation-app-qa/` and `schema-reconciliation-live/` records. Their actual contents determine the live outcome; file presence alone is not approval or deployment proof.
# Subsequent authenticated continuation

The original migration completed, and the first follow-on attempt timed out after parent verification with its lease released. The explicit newly approved continuation subsequently completed all three dedicated schema resources. See [SCHEMA-CONTINUATION-QA.md](SCHEMA-CONTINUATION-QA.md) for the corrected retained state, immutable lineage, independent approval, native readback and remaining deployment gates. Earlier preparation-only statements below are historical.
