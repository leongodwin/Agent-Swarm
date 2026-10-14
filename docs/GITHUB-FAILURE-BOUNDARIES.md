# Distinguish GitHub absence from unavailable evidence

Issue status formerly returned null after every read failure, PR diff failures
became empty strings, and evidence-branch read failures initiated branch creation.
These paths now preserve unavailability instead of asserting absence or content.
Issue absence requires an explicit nullable issue in the exact readable repository;
known states require the exact requested issue number. Partial GraphQL errors,
wrong scope and unknown states fail with generic diagnostics. Routing waits for
all prerequisite reads to settle and refuses edits if any read is unavailable.

Evidence-branch creation requires a scoped observation of absence, alongside a
readable default-branch reference. Repository/reference identities and commit
acknowledgements are checked. Unavailable reads cannot create branches, and
unverified writes invalidate readiness caching. Evidence paths/bytes are bounded
and copied before waiting. Per-repository sequencing avoids concurrent content
writes; failures do not poison the queue or repeat a failed upload. A successful
URL requires the acknowledged path and Git blob digest to match the upload.
Shared CLI JSON parsing rejects duplicate keys before metadata is consumed.

The API shapes and sequencing follow GitHub's primary references:
[repository queries](https://docs.github.com/en/graphql/reference/repos),
[content acknowledgements](https://docs.github.com/en/rest/repos/contents) and
[reference acknowledgements](https://docs.github.com/en/rest/git/refs).

The connected repository read succeeded without writes: leongodwin/Expnese-App2,
issue 8 CLOSED, readable default branch and existing evidence branch. This proves
read-query format compatibility, not deployment, upload or all-CI acceptance.
Provider-write tests use mocks. Native command tests verify literal argument/stdin
boundaries and nonzero failure propagation through owned synthetic processes.

Initial expanded fixtures failed because their mocked CLI returned strings rather
than promises, and a repaired closed prerequisite correctly remains unroutable.
Those development failures are retained in task history. The corrected checks
verify unavailable routing remains held, known closed-state refusal is refreshed,
and upload receipt/caching/concurrency behavior is preserved.

Final backend verification passed 2,272 tests with one TODO. Branch coverage was
71.83% (7,631/10,623), below the unchanged 90.01% gate. The production build passed.

The 99.5% all-CI/integration target, complete tenant schema/DLP governance, full
recovery and backend coverage target remain separate requirements. Copilot Studio
stays paused; Codex remains default with Gemini/OpenCode supported.
