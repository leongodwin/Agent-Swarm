# Gemini administrator installation and authenticated QA

> Newer evidence: [actual server restart and scheduler retry enforcement](SERVER-RESTART-SCHEDULER-QA.md). Earlier restart/scheduler gaps below describe their historical snapshot.

> Latest follow-up: [provider recovery, retained adoption and durable retry holds](LIVE-USAGE-GAPS-QA.md). Earlier provider-error blockers below describe their historical snapshot.

15 October 2026. This follow-up supersedes the Gemini installation blocker in the earlier native-usage QA snapshot.

## Installed and independently checked

Administrator installation completed through Windows UAC at `C:\Program Files\Agent Swarm\Gemini`. The reviewed update preserved the initial files in `backup-42f2db9e-4cc4-40ff-9ed9-c7bde5f2571f`. Hook and both protected profiles match reviewed staged bytes. Administrator ownership and read/execute-only ordinary-user ACLs passed inspection. Both actual native protected-profile checks passed independently (`normal: null`, `browser: null`). Evidence: `output/gemini-admin-install.log`, `output/gemini-admin-update.log`, `output/gemini-installed-hashes.json`, `output/gemini-installed-acl-final.json`, and `output/gemini-installed-native-validation.json`.

The installed CLI was observed as 0.64.0 during this work, after the earlier 0.62.0 inventory. The cause of that external version change was not established. Current [native hook shell contract](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/core/src/hooks/hookRunner.ts) and [record types](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/core/src/services/chatRecordingTypes.ts) were checked before accepting live evidence. Protected profiles now disable automatic update and update notifications; this does not pin the globally installed binary against other processes.

## Findings fixed

- Inherited PowerShell 7 module paths prevented the native Windows PowerShell ACL validator from loading Get-Acl. Only Windows Gemini child environments now remove PSModulePath; parent and machine environments remain unchanged. Negative native security verdicts still block launch.
- Hook commands now use the native platform shell grammar, including executable paths with spaces and apostrophes. Independent tests execute real PowerShell allow/deny hooks and preserve literal stdin JSON.
- Native resumed transcripts contain content-only patches. The collector accepts bounded patches to known message content while rejecting receipt changes, unknown message IDs, removals and malformed patches. Prior token receipts remain immutable.
- Actual terminal cancellation emits `Request cancelled.`. Gemini Escape handling recognizes that native notice, checks its count increased in the owning session, and retains interrupted usage as partial with unknown totals.
- The live harness now requires an explicit live flag, isolates synthetic work, checks current-session interruption ownership, rejects incomplete matrices and verifies native cleanup before helper exit. Earlier failed observations remain in the evidence rather than being rewritten as passes.

## Authenticated native matrix

Existing native authentication was used without copying or displaying credentials. Tasks prohibited tools, file changes and delegation; the local MCP gate denied tool execution. There was no live office restart or tenant mutation.

| Case | Input / output tokens | Evidence |
| --- | --- | --- |
| Success | 28,420 / 179 | Exact synthetic success marker; complete receipt |
| Semantic rejection | 28,421 / 871 | Native completion succeeded, deliberate task rejection marker retained; task acceptance false |
| Corrected retry | 28,420 / 190 | Complete receipt and accepted marker |
| Native idle resume | 28,513 / 100 | Same retry session; earlier 56,886 / 284 excluded |
| Actual Escape interruption | Unknown / unknown | Native cancellation notice, interrupted outcome, partial evidence |
| Invalid-model probe | Unknown / unknown | Bounded stop; no verifiable provider error returned |
| Normal task after probe | 28,420 / 261 | Complete accepted receipt; proves access, not provider-error recovery |

Independent QA compared scoped native file hashes and counters with `output/gemini-native-receipts.json` and `output/gemini-usage-live.json`. The core success/rejection/retry/resume/interruption matrix passed. The optional provider-failure probe remains unsuccessful because it produced no verifiable provider error. All USD values remain unknown. Receipts describe the observed root-session subset, not provider billing.

## Regression verification

The final serial whole-backend coverage run exited zero: **187 files, 3,450 passing tests**, two platform skips and one existing TODO. Branch coverage is **90.10% (12,067/13,392)** against the unchanged **90.01%** gate. A subsequent two-file harness run passed **14 tests**, including the newly added Gemini explicit-live guard after the full run. No backend source changed after coverage. Production client/server build passed with the existing chunk-size warning. Focused cancellation suites passed 90 tests; independent environment and actual PowerShell hook acceptance passed seven tests. Typecheck passed. Logs: `output/gemini-admin-coverage-final.log`, `output/gemini-live-harness-tests.log`, `output/gemini-admin-build.log`. Independent review reported no outstanding actionable findings in the core live matrix.

The isolated Chromium execution-efficiency acceptance passed on port 4497 (one test). Package installation/version/demo-start smoke passed on port 4496 with two floors, eleven fake agents and the packaged client served. Logs: `output/gemini-admin-e2e.log`, `output/gemini-admin-package.log`. Independent final source/documentation review and whitespace checks passed.

## Remaining evidence

A genuine provider-side failure and subsequent recovery still need live evidence. Cold adoption, delegated/ancillary accounting, durable coordinator retry-cap behavior and billing reconciliation remain outside this completed matrix. Power Platform deployment and application acceptance are separate gates. Existing repository changes were preserved; no commit or push was made.
