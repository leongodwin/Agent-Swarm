# Backend pilot completion — 15 October 2026

CorporateExpenseBackendPilot 1.0.0.0 was imported into the approved development environment and independently accepted by Sherlock. The shared delivery record now holds the completed slice receipt. This completes the agreed reference-only backend pilot; the wider Canvas/flow/Copilot application remains outside this acceptance.

| Evidence | Identity | Completed UTC |
| --- | --- | --- |
| Recovery before import | `cfdccad2-9af7-4381-be8b-2c48fd503826` | 2026-10-15T13:01:57.258Z |
| Platform import | `8dfd28d6-7d79-4393-9a29-bd5b0da8dc8b` | 2026-10-15T13:27:12Z |
| Acceptance after import | `062368f2-1ad8-47ea-8742-f21ade3d1d38` | 2026-10-15T13:42:22.089Z |
| Independent backend QA | Sherlock | 2026-10-15T13:45:33.456Z |
| Shared slice receipt | revision 17 | 2026-10-15T14:01:20.004Z |

The native platform import job reached 100% under the approved maker, within the runner's import interval. Both new transaction journals contain four write intents and six reads. The server rejected the 101-character title with the explicitly pinned `0x80044331`, preserving the selected business values, ETag, version number and service revision. Guarded title changes and restoration returned the original business hashes. Both restored Draft rows remain retained for audit; no DELETE was issued.

Three synthetic audit drafts remain: the two accepted R/J rows above and failed-attempt draft `c99599a1-a20d-4e2b-9cf8-b4889a810513`. The failed draft was reconciled as unchanged with no children and remains separate from successful acceptance. Earlier failed runs, rejections and journals were preserved without replay.

## What changed

- Finished the isolated native reference-only package, manifest and exact data/recovery contracts using the existing `exp` publisher.
- Added existing-licence/manual governance with five independent controls, strict phase/evidence bindings and conflict blocking. Optional advanced automation is neither required nor claimed.
- Corrected registered readiness probes, phase authority before transaction journalling, the observed length-validation code and all current acceptance mappings.
- Held manager instruction edits during active reviews; added an explicit QA slice-closing task.
- Included raw recovery proof in future evidence collection and fixed duplicate filenames that prevented restart. The original history was archived; exact deduplication preserved the accepted hash. A real restart successfully reloaded the accepted run.

## Validation and scope

Test Files  146 passed (146)
Tests  2358 passed | 1 todo (2359)
Duration  296.97s (tests 94%, import 5%, transform 1%)

Full build and type checking passed. Earlier interrupted/timing-failure test runs remain in the retained validation history. Regression tests cover pending approval before journalling, listed/unlisted validation codes, raw-journal tampering and restart readability.

The deployed transaction execution used central runtime `b33e13357f953d457ce0d0dc5428a2fcced04dd7`. Later closing/archive/restart fixes are on the delivery-workflow branch; the closing task ran through that corrected path. The accepted evidence set has **137 unique signed files** and hash:

`e5f9422cc518f4d11dcdc4eb9cbeaf53367ccdeee0fe2a41016145256846e601`

QA explicitly accepted the signed recovery summaries and native receipts while identifying seven ancillary files outside the aggregate hash, including the two original raw recovery files. The latest collector includes those two raw files; a read-only dry run against the actual pilot archive produced 139 candidate files without changing the original accepted signature. This is evidence-collection validation, not another tenant journey.

This acceptance does not certify production, employee isolation, UI journeys, least privilege, tenant-wide Purview/DLP enforcement or ongoing monitoring. Scheduled health follow-up remains pending. Copilot remains paused. Original office settings were restored and maintenance retained; no background continuation was scheduled.

## Reproducible identity and evidence

| Item | Pinned value |
| --- | --- |
| Shared delivery record | `80ab1d55-b4ac-4371-b6d1-0a9df0fc97a1`, revision 17 |
| Record hash | `b814a00315f52fe0844a17a6e105a098a6c5831e9463e6a5d5356c6e17b85e03` |
| Release | `4b9e6124-4524-4e33-a898-e2cc2b1073de` |
| Run | `9b8747a4-9aa6-4762-b57f-4ed063b7fe8d` |
| Deployed solution source | `13a562bc17fe6155d3804a4e7b6c8888ddfffcdd` |
| Unmanaged package SHA-256 | `e56082adb3a89c9a1852829afcb7e7db43692fd8a1e3ecb428962de3434e054e` |
| Final tested central source | `7f1cc7f6bc40f8d6bb44cc97a31180d6d3155cac` |

The approved target was the connected default development environment, not a sandbox. The package used the existing `exp` publisher and exactly two unchanged existing-table references. It contained no schema, roles, apps, flows or plug-ins and cannot bootstrap a fresh environment. The existing maker's administrator context was observed; least privilege was not established.

This document records the accepted outcome and evidence identities, not the evidence archive itself. Authorized operators must preserve the office delivery/planning state and original evidence bytes for independent re-verification. The sanitized local handover bundle was retained under `output/p0-completion/`, outside tracked source: `final-record-accepted.json`, `final-delivery-accepted.json`, `qa-slice-closing-log.json`, `importjobs-observed.json`, `duplicate-evidence-repair.json`, `raw-recovery-retention-dryrun.json`, `final-full-tests.txt` and `final-build.txt`. These files are machine-local and are not public links or a substitute for custody of the signed archive. Do not commit credentials, private payloads or raw tenant responses to publish this report.

## Remaining work and ownership

- Delivery owner: retain the accepted package, records and archive; keep later evidence-collector validation separate from the original acceptance signature.
- Delivery owner and independent QA: run a scheduled health observation when the office is available and record current health separately from historical acceptance.
- Application owners and independent QA: complete connected Canvas authoring/compilation, actual UI receipt journeys, approval/notification flows and intended-user permission tests before full-app acceptance. Preserve other component owners' work. Copilot work remains paused until explicitly resumed.
- Governance and operations owners: establish required production controls, least privilege, broader recovery and operational readiness for any proposed production scope. The manual development path does not relax production requirements.

See [current status](PRODUCTION-GOAL-STATUS.md), [roadmap](AGENT-SWARM-IMPLEMENTATION-PLAN.md) and [delivery contract](DELIVERY.md).

## Change references

- [Delivery workflow PR](https://github.com/leongodwin/Agent-Swarm/pull/3)
- [Merged pilot contracts/design PR](https://github.com/leongodwin/Expnese-App2/pull/39) (requires repository access)
