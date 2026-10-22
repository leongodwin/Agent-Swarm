# Evidence-preserving history storage and delivery continuation

## Verified storage repair

The 4 MiB single-file history admission blocker is resolved without deleting evidence or raising that per-file limit. Small legacy stores retain their version1 format. When a history crosses the limit, `DeliveryRecordStorage` writes bounded, immutable, hash-addressed snapshot objects and commits a version2 index through the existing atomic writer. Every referenced object is regular, canonical, single-link, size/count/hash checked. Snapshot order and the original record/review provenance are validated during restart.

The initial migration retains the **exact original legacy bytes**, including whitespace and all review metadata. Objects are fully written, synced and rehashed before the authoritative index changes. Interrupted writes leave retained, unreferenced objects; they are not enumerated into the live history or automatically deleted. Missing indexes with retained snapshots, missing/corrupt objects, duplicate/reordered chunks and linked paths fail closed. Failed publication does not adopt a new in-memory revision.

Bounds remain explicit: 4 MiB per object/index, at most32 referenced history chunks and the existing1000-record ceiling. This is bounded segmented storage, not unlimited retention. Keep the complete `delivery-records.json` plus its `delivery-record-history` directory and retained migration backup together when backing up or moving the office. A version1-only binary cannot read the new index; rollback must use a compatible reader and validated complete history, not flatten, truncate or replace it with an old snapshot. No automatic garbage collection is implemented.

Implementation: `server/deliveryRecordStorage.ts`, integrated into `server/deliveryRecords.ts`. Independent adversarial tests: `server/deliveryRecordStorageIndependentQa.test.ts`. **65 storage/record tests passed**, including7 independent migration/crash/cancellation/corruption/path/restart tests; TypeScript checks passed. Logs: `output/history-storage-tests.log`, `output/history-storage-independent-tests.log`, `output/history-storage-independent-typecheck.log`.

## Live migration and revision46

Before changing the working office, an isolated copy of the actual45-record history migrated, saved revision46 and restarted successfully. Every prior record's complete object matched; the live file remained unchanged. Receipt: `output/history-storage-pilot-verification.json`.

The paused office accepted graceful handoff; oldPID38924 exited before replacement51860 started against the same home/port. Revision46 was then published through the normal manager-record API. At **2026-10-18 15:26:10 UTC**, all45 previous records/reviews matched field for field, and the exact **4,102,314-byte** legacy file was retained with SHA256 **25825d1b838a32ae9f5248967a442ebed05330af330101621e6bc1ef47cb67a6**. The new index was713bytes and its chunks4,102,314 and96,551bytes. Revision46 SHA256 is **9f35605676ab6b4b7e38dce973776ee6ef6804dbb687dd2a23d94866f9a3cf38**. Receipt: `output/history-revision46-live-verification.json`.

A second graceful restart toPID31336 proved the running service could read the version2 history and return that exact revision46/hash. Independent QA repeated the full live census and hash comparison. Evidence: `output/history-storage-live-restart.json`, `output/history-storage-independent-live-audit.json`. Raw pre-migration history and handoff/index/record receipts remain in `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/history-storage-migration/20261018T152524661170Z`.

## Additional delivery repairs and revision47

The source-pin correction is now published in revision46. Further narrow design repairs were committed and pushed to the existing showcase branch at **681c6f62eadeffb50ada06eb9e3acaf3cfa02d67**:

- `docs/delivery/EXPERIENCE-CONTRACT.md` specifies visual tokens, responsive breakpoints, accessible control labels, all six UI-state actions/assertions, keyboard behavior and measured task-time targets. These are proposed implementation requirements, not claims that the app already implements them.
- Complete current native check/context/authority/capability/identity/snapshot and production-factory source definitions are retained as four read-only source snapshots with an index. Git attributes preserve their exact bytes. Independent QA compared all source/index hashes with both the original source and committed blobs. The production factory remains unsupported/incomplete; source availability is not capability.
- `server/governanceCriteria.ts` adds separate exact standard-entitlement and independent-delivery criteria for happy/denied/failure scenarios in both integration phases:12 added bindings. All previous cases, requirements, owners, assumptions and stop conditions remain. Conflicting bindings fail closed. **Six governance tests passed**, including3 independent tests, plus TypeScript checks. These bind required future assertions and do not fabricate driver execution or acceptance receipts.

All seven new source artifacts were captured completely and hash verified. Independent QA accepted publication of this design-repair candidate, explicitly withholding architecture/task/runtime approval. Evidence: `output/planning47-independent-source-audit.json`, `output/native-interface-independent-audit.json`.

Revision47 was published normally at **15:35:38 UTC**, with every previous46 record preserved and the original legacy snapshot unchanged. RecordSHA256: **f7c7725103c6d236bc5f91b88bc7e5fa5ba772c4d55b8ffeafe719942c5e69e4**. Receipt: `output/revision47-contracts-live-verification.json`.

## Delivery rerun and genuine remaining blockers

At **15:35:39 UTC**, normal delivery admission returned **HTTP409 — Real delivery is not enabled**. There are zero runs/releases, no policy and no architecture/task approval on revision47. The office is paused with zero worker sessions and zero office-owned native PIDs. Receipt/archive: `output/history-repaired47-delivery-rerun.json` and `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/history-repaired47-delivery-rerun/20261018T153539382025Z`.

History capacity no longer blocks the next revision. Delivery still needs the trusted native execution/history/denied-identity/termination/cleanup implementation and real evidence; exact dedicated-channel/flow/conditional-claim/publication/recovery contracts and permissions; operation-specific standard-use/writer evidence; and actual executable integration drivers, app implementation/compile/export/runtime acceptance. Expired Canvas/schema/licensing observations retain their original timestamps and must be genuinely recaptured where required. Source inspection was not used to extend native evidence lifetimes. The prior assigned architecture rejection remains preserved at45; current47 is unreviewed, not implicitly approved.

No unchanged model-review retry was made while these critical capabilities remain unresolved. Local independent QA and source-contract repairs do not grant release approval or justify enabling delivery. The user's saved Studio was not closed, unlocked, edited or published during this run; ownership must be checked before the next authoring operation.

Existing dirty Agent Swarm changes and untracked showcase history were preserved. No DLP implementation, policy change, consent grant, new credential, flow publication or tenant/business-data mutation was performed.
