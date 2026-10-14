# GitHub verification boundary

PR check rollups now keep missing, incomplete or unknown conclusions pending rather
than treating them as passing. Stale checks are failing. Completed Success, Neutral
and Skipped checks retain GitHub's nonblocking interpretation; this is not proof
that all CI/integration work ran successfully. See
[GitHub's check definitions](https://docs.github.com/en/graphql/reference/checks).
Unknown issue states now return unknown instead of being silently treated as Closed.

Selected PR scan files require an exact repository/PR/commit identity, bounded
unambiguous paths and supported file statuses. File content must have canonical
base64, an exact nonnegative declared byte count and matching Git SHA-1 blob IDs in
both the pinned listing and contents response. UTF-8 decoding is fatal rather than
substituting replacement characters. Newline wrapping is accepted, corrupt padding
is rejected, individual files are capped at five million bytes and selected decoded
content at 32 MiB. A changed PR head before/after the scan or the 3,000-file API
listing limit denies verification. GitHub's
[contents API](https://docs.github.com/en/rest/repos/contents) supplies these metadata
fields; unavailable/unsupported encodings stay blocking.

Regression cases cover positive/negative/unknown check conclusions, issue states,
head drift, unsafe and duplicate paths, malformed base64, size mismatch, blob
identity, Unicode, unsupported file metadata and cumulative/truncated inventories.

On 14 October 2026 a read-only native check of Expense PR #32 at
`1d1658213d5c60aeb9030c06b4761cb9120732f9` verified one selected file and stable heads
in 6,016 ms. Its rollup was None, not a passing CI run. No PR, branch, issue, comment,
permission or tenant component changed.

This improves the selected-source heuristic scan and GitHub state boundary. It
does not establish full source/binary/package coverage, effective tenant DLP/schema
compliance, independent QA, merge authorization or the 99.5% reliability target.
Unknown hash formats, oversized/unsupported content and opaque resources remain
unverified. Codex remains default; Copilot Studio stays paused.
