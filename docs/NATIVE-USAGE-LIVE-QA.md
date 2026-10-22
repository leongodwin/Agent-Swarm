# Native usage live verification — 15 October 2026

> Newer evidence: [actual server restart and scheduler retry enforcement](SERVER-RESTART-SCHEDULER-QA.md). Earlier restart/scheduler gaps below describe their historical snapshot.

> Latest follow-up: [provider recovery, retained adoption and durable retry holds](LIVE-USAGE-GAPS-QA.md). Earlier provider-error blockers below describe their historical snapshot.

> Current Gemini follow-up: [administrator installation and authenticated QA](GEMINI-LIVE-QA.md). The earlier installation blocker below is historical; provider-error evidence remains outstanding.

## Outcome and scope

Codex authenticated live verification partially completed; Gemini installation and live verification remain blocked. Existing application changes were preserved. No live office, repository delivery, tenant or protected machine profile was changed. No production-readiness, billing or savings claim follows.

Codex 0.162.1 reports authenticated ChatGPT login. Gemini installed package is 0.62.0; its selected authentication type is API key, but authenticated model access was not tested. No credential values or personal historical transcripts were inspected or exported.

The explicitly opted-in harness `scripts/verify-native-usage-live.ts --live` used a fresh temporary office home, synthetic cwd and private Codex home. It copied existing authentication only into that isolated home, removed the copy after verification, and used the production CLI runner, native hooks, session evidence writer and collector. Tools were denied; no project changes were requested. Native receipt evidence is a bounded sanitized extract from only these newly created sessions.

## Verified native observations

| Case | Input / output tokens | Independently verified result |
| --- | --- | --- |
| Success | 22,928 / 10 | Actual response `CUBEFARM_USAGE_OK`; exact owning root/session/turn receipt |
| Semantic rejection | 23,194 / 11 | Actual `CUBEFARM_EXPECTED_FAIL` fails the required `CUBEFARM_USAGE_OK` output contract; usage remains measured despite rejection |
| Corrected native attempt | 23,193 / 10 | Actual `CUBEFARM_USAGE_OK`; evidence links to the rejected attempt |
| Native resume | 23,224 / 11 | Same native session as preceding attempt; only the resumed turn is counted, excluding prior 23,193 / 10 |
| Manager stop | null / null, partial | Genuine manager-stop path; reported as failure, not an interrupted outcome |
| Native terminal Escape | null / null, partial | Escape sent to the actual PTY; genuine native `Interrupt` hook, `interrupted: true`, terminal evidence outcome `interrupted` |

USD remains null. The corrected attempt is a linked native task retry, not proof of durable coordinator scheduling/retry caps. The semantic rejection is not a provider failure. Interrupted native work may incur usage without a completed receipt; null is not zero.

Independent QA compared all four complete receipts, total/subset consistency, source `cli`, isolated cwd, root/session/turn identity, native completion and synthetic outputs. QA confirmed resume exclusion and the genuine Interrupt hook. Additional background completion notifications were excluded by owning-session attribution; ancillary work is not included in these measured counters.

The initial harness attempted a subsequent launch before native cleanup settled. Agent Swarm correctly quarantined that request. The harness now waits up to 15 seconds for cleanup before admitting the next case; it continued without repeating the original successful task. Subsequent native process cleanup was verified. It also records semantic verdicts separately from native completion, links corrected attempts, requires explicit `--live`, and skips already completed cases on continuation to avoid duplicate paid work.

Local follow-up: **133 tests passed across five files**, including the explicit-opt-in guard and collector/runtime/bridge acceptance tests. Global typecheck and whitespace checks passed. No application collector logic changed during this live follow-up; the previous whole-backend coverage result is historical, not a newly rerun coverage claim.

## Gemini protected bridge blocker

Expected directory `C:\Program Files\Agent Swarm\Gemini` is absent. The current process has no Administrator token. The staged installer was attempted without elevation and exited at its Administrator check, before changing files or ACLs. A writable user-profile substitute was not used.

Independent QA confirmed the staged files exactly match generated source/settings:

| File | SHA256 |
| --- | --- |
| gemini-hook.cjs | 62766e34a49223504c9e40c3bb37037d166d1d70286f02bab89e196d33756887 |
| settings.json | b5236c9d5f7c56b3890059e375ef0d54f15628bb4c2c89d6b4ce23d055a08a98 |
| browser-settings.json | e7178125913f71ee71669be53e3a5eb58671cb273e15648d27042555a464af92 |

An administrator must review and execute the staged installer from an elevated PowerShell:

```powershell
& 'C:\temp\cubefarm\.swarm-reliability\gemini-governance-install\Install.ps1'
```

The existing installer is for a fresh directory and refuses to overwrite an existing installation. After installation, independently compare installed hashes and ACLs and run the installed Gemini native security validator for both normal and browser profiles. Only then run authenticated synthetic Gemini cases. No live office restart is required for these isolated verification tasks, and none was performed.

## Remaining live blockers

- Gemini administrator installation, native protected-profile validation and authenticated success/failure/retry/resume/interruption matrix.
- Genuine provider-side failures: none occurred. No requested error string, semantic mismatch or local admission rejection is represented as a provider outage.
- Cold adoption, delegated/ancillary work attribution and durable coordinator retry-policy behavior were not exercised live.
- Whole-office costs, invoice reconciliation, savings and Power Platform deployed acceptance remain outside this verification.

## Evidence and ownership

- `output/native-usage-live.json`: attempt/evidence IDs, native hook metadata and terminal receipts.
- `output/native-usage-native-receipts.json`: sanitized fresh native receipt/completion extract with source file hashes.
- `output/native-usage-live-initial.json`: original success snapshot before cleanup-wait correction.
- `output/native-usage-live.log`, `output/native-usage-escape.log`: bounded native harness results.
- `output/gemini-protected-install.log`: actual non-elevated installer refusal.
- `output/native-usage-live-regression.log`: 133 local regression tests.

The live harness exits nonzero while any requested boundary remains blocked. Independent QA found no further actionable issues in the reviewed scoped evidence. Administrator installation and the remaining real runtime matrix still block a complete verification claim.
