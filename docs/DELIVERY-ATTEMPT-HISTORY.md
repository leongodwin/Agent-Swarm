# Retained delivery attempt history

Each admitted attempt to execute an approved release has a separate identity, even when recovery reuses its deployment run and import checkpoint. Preparation is saved before asynchronous architecture/capability checks. Preparation failure, execution failure, cleanup failure and restart interruption remain visible after a retry. Superseding a pending QA review retains that outcome. Success requires the assigned independent reviewer to approve the current captured evidence; reaching the review stage alone is pending acceptance.

Saved history is bound to the approved release, repository, commit, target environment, acceptance profile and linked run. Startup validates these relationships, identities and lifecycle timestamps; malformed history blocks admission. Existing runs become explicitly identified legacy records without inventing their historical attempt counts.

The Operations panel shows completed successes/failures, active attempts and pending reviews separately. It exposes a complete 30-day delivery rate only after collection covers the whole window. The window selects attempts by start time, so active/pending attempts do not enter the completed denominator. A failure followed by a successful retry produces two completed attempts and 50% recorded success, even if they share one run and execute only one import. Successful functional-development acceptance does not imply production acceptance.

This history covers admitted delivery attempts, not rejected requests before release/readiness checks, CI providers, ongoing health checks or every integration system. It therefore cannot establish the overall 99.5% clean CI/integration target. Records live in the existing locally owned delivery state; they are not a cryptographically protected audit ledger.

Retention is bounded at 5,000 attempts and blocks further admission when full instead of silently deleting failures. Export/rotation and automatic preflight retry backoff remain implementation work. Repeated blocked scheduler attempts can fill retention; maintenance drain remains enabled in the live office.

Validation for this batch: 1,239 tests passed with one existing TODO across 104 files, build/typecheck passed, and one isolated Chromium Operations test passed, including read-failure handling. Synthetic delivery tests exercised failure then reviewed success without a repeated import, interrupted preparation on restart and malformed history rejection. Whole-backend branches are 5,671/8,833 (64.2%); the unchanged 90.01% coverage gate fails. Browser data was synthetic, and no new tenant execution, remote CI result or production acceptance is claimed.

Local ignored evidence: `.swarm-reliability/delivery-attempt-coverage.txt`, `delivery-attempt-build.txt` and `delivery-attempt-ui.png`. Codex remains the default; only Codex, Gemini and OpenCode are supported. Copilot Studio remains paused.
