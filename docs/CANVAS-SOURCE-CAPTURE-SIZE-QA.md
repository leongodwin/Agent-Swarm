# Canvas source capture receipt budget

The native worker previously synced the authored screen successfully but could
not retain it: the screen exceeded the 24 KiB per-file and 16 KiB encoded-source
limits. The failure receipt and source remain historical evidence.

Inline capture now accepts at most 48 KiB per file, in total raw source, and as
encoded file entries. The existing complete preflight receipt limit remains
64 KiB, reserving 16 KiB for its metadata; that final limit still fails closed.
No content is truncated or omitted. Larger sources remain explicitly unsupported.
Native call/directory correlation, file count, UTF-8, link, identity and repeat
hash checks are unchanged. Capture grants no authoring or QA authority.

Acceptance tests cover a full 40 KiB screen and exact hash/content, aggregate
overflow, JSON escaping, multibyte expansion, retained earlier receipts, and
complete character-paged QA reads of a large receipt. Existing negative source
and producer tests remain required.

The retained real roundtrip screen is 39,601 bytes in this checkout (CRLF); its
three encoded file entries total 41,658 bytes and pass without truncation.
This is local retained-source verification, not a fresh provider sync or a live
publication/deployment result. The previous office was found stopped; normal
runtime and current task admission must be established separately.

## Current pipeline rerun (21 October 2026)

The normal office launcher loaded the fixed bundle at PID 58076. Supported
startup recovery preserved the old owner marker and all evidence; its inspection
confirmed absent owner and empty delivery release/run history. The old Alan-only
Canvas lease was released through its original token after process-absence,
idle native/authentication and no-pending-handoff observations. CloudAsset was
not touched.

Revision 125 retained previous receipt contents and original timestamps inside
fresh local-byte-readability observations. All 56 current critical evidence
receipts passed full paged reader/hash validation. Synthesis completed as
HLD-b68e99d2-cdc1-4a58-96cb-7524be232755. Independent native reviewer Marple
rejected the revision; task approvals were withheld. Exact decision is retained
in output/source-size125-independent-review.json.

Remaining admission blockers are current read-only entitlement, exact
app/connection/list permission and saved-source/session evidence, and an explicit
bounded constituent-age/queue-delay/revalidation rule at browser action admission.
The reviewer did not establish an exploitable code defect. Old provider facts
were not renewed by publication wrappers. No further identical review was run.

No new Save/Publish, msapp export, feature-package deployment or live journey
acceptance occurred in this rerun. The dedicated app remains visibly saved but
unpublished. Native feature work in PR10 and accepted original PR9 evidence are
preserved, including original113 proof needed for normal future reconciliation.
No DLP or unrelated infrastructure changes were made.
