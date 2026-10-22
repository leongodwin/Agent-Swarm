# Native usage live-gap follow-up

> Newer evidence: [actual server restart and scheduler retry enforcement](SERVER-RESTART-SCHEDULER-QA.md). Earlier restart/scheduler gaps below describe their historical snapshot.

15 October 2026. Existing changes and all earlier failed observations were preserved. This work changes verification scripts, acceptance tests and documentation; it does not change backend collectors, installed protected profiles or the running office.

## Verified with existing authenticated Gemini 0.64.0

The earlier invalid-model probe did not capture verifiable provider-error evidence. The current probe watches the exact native model-not-found message for the requested synthetic invalid model after the owning BeforeAgent hook. It records session and time before stopping the fallback dialog. It does not accept an unrelated numeric 404 or a manager stop as provider-error evidence.

The installed contract and upstream release were checked: [404 classification](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/core/src/utils/googleQuotaErrors.ts#L225) creates ModelNotFoundError; [native dialog](https://github.com/google-gemini/gemini-cli/blob/v0.64.0/packages/cli/src/ui/hooks/useQuotaAndFallback.ts#L161) renders the observed message. This establishes a native contract-based provider 404 observation, not a captured raw HTTP response.

| Case | Actual result | Usage evidence |
| --- | --- | --- |
| Provider invalid-model error | Native model-not-found observed at 19:51:30.354 UTC in session d7f022ed-41eb-4399-9278-7ff396b890a6; fallback dialog then stopped for cleanup | Failure; partial, both token totals null; no model response receipt |
| Linked corrected-model recovery | New native session; exact synthetic success marker; retryOf identifies failed evidence f71a49ca-f85e-4c01-bc74-81d852575f7a | Complete 28,420 input / 165 output; independently matched native receipt |
| Retained seed | Same native process/session as next two rows; accepted synthetic output | Complete 28,420 / 167 |
| Retained follow-up | Same process/session; prior response excluded | Complete 28,446 / 48 |
| Ownerless in-flight adoption | BeforeAgent at 19:57:07.160 UTC, attachment at 19:57:07.161 UTC; native output accepted | Correctly unknown/null because the new owner missed the initial work boundary, although native response itself reports 28,472 / 40 |
| Automatic attempt cap | Three real native attempts reserved, launched and receipt-bound in the production ExecutionLedger; fourth automatic reservation denied without appending | Two measured attempts, one unknown; total measured subset 56,866 / 215 |
| Durable cap reopen | Fresh child process opened the same real ledger and also denied another automatic reservation | Same ten scoped events retained |

The corrected retained run exited zero. Both strict live gates independently return true. All USD costs remain null. The recovery is an explicit new-session correction, not transparent automatic retry of the failed request. The cold case proves ownerless in-flight adoption within one server process; the ledger reopen separately proves persistence across a process boundary.

## Findings fixed and acceptance tests

- Replaced final-screen numeric-status approval with an owning-session live native dialog observation and strict chronological retry linkage.
- Fixed outcome names in the new evidence gate to match the actual success/failure ledger contract.
- Require current-attempt prompt/start timestamps; retain failure and recovery evidence separately.
- Require exact native process/session identity, prompt-before-attachment evidence, receipt-bound ledger transitions, untouched fourth-attempt history and fresh-process denial before retained-gap approval.
- The first retained probe sent paste and Enter together, producing no BeforeAgent. It remains a failed observation. Corrected input uses bracketed paste and delayed Enter, accepts only fixed synthetic prompts, and has ordering/control-input regression tests.
- Corrected verification configuration uses a hash of the harness source as its admission identity and a separate scoped ledger namespace. The earlier scope's three-attempt hold remains intact; history was not deleted to obtain another attempt.

Independent QA added 82 provider/retained/input acceptance tests, including echoed error text, wrong session/model/time, missing or unsafe usage, unlinked recovery, malformed ledger transitions, missing native process identity, false cold adoption, cleanup failure and terminal control injection. The final focused regression passed **265 tests across nine files**, including collectors, real runtime lifecycle, execution ledger and explicit-live guards. Typecheck and production build passed; build retains the existing client chunk-size warning. No backend code changed in this follow-up, so the prior whole-backend **90.10%** coverage result is historical and was not rerun or presented as a new measurement. Whitespace checks passed. Package installation/version/demo-start smoke also passed on isolated port 4496 (two floors, eleven fake agents, packaged client served); log: `output/gemini-live-gaps-package.log`.

Independent QA read only hook-scoped synthetic native transcripts, validated session/project hashes, compared exact counters, and checked exported events against the persisted real ledger. No actionable findings remain in this implemented scope.

## Evidence

- `output/gemini-usage-live.json`: full observations, including earlier failures and latest verified cases.
- `output/gemini-live-gaps-native-receipts.json`: bounded native file hashes and synthetic receipt counters, without credentials or reasoning.
- `output/gemini-live-gaps-validation.json`: strict provider and retained gates, exact final adoption case and ledger proof.
- `output/gemini-provider-followup-live.log`: fresh provider error and corrected recovery. This first invocation exited nonzero because the newly written gate initially used the wrong outcome labels; the fixed gate and subsequent corrected live invocation pass without repeating provider calls.
- `output/gemini-retained-corrected-live.log`: corrected retained live run, exit zero.
- `output/gemini-prior-hold-preserved.json`: independently reopened prior scope remains held and its exported events are unchanged.
- `output/gemini-usage-live-before-provider-followup.json`, `output/gemini-usage-live-provider-recovered.json`, `output/gemini-usage-live-retained-first-probe.json`: preserved checkpoints.
- `output/gemini-live-gaps-final-tests.log`, `output/gemini-provider-typecheck.log`, `output/gemini-live-gaps-build.log`: local verification.

Authentication remained native; no credentials were printed or changed. Synthetic tasks denied tools and delegation. There was no tenant mutation, live office restart, protected-file update, commit or push.

## Remaining verification work and external evidence

1. **Transient provider recovery and Codex provider failure:** no genuine authenticated 429/5xx event was observed. The Gemini 404 establishes explicit configuration correction only. A provider-controlled fault/test endpoint or naturally occurring bounded failure is needed; exhausting quota or fabricating responses would not establish this evidence.
2. **Actual keeper/server restart during work:** the current cold test does not restart a server process. A dedicated isolated keeper and two-process handover fixture must capture pre/post native PID, hook routing and missing-boundary accounting. This is separate from the completed fresh-process ledger reopen.
3. **Full coordinator retry-hold journey:** the real ledger was wrapped around real native attempts, but the worker scheduler/UI path was not exercised end to end. An isolated admitted task and scheduler restart must prove it refuses a fourth native launch without bypassing readiness/authority controls.
4. **Delegated and ancillary accounting:** live delegated work was not exercised in this no-tools matrix. Root receipts cannot establish invisible provider work; accounting remains incomplete until a native attributable receipt contract exists and a bounded delegated case is independently observed.
5. **Billing and Power Platform acceptance:** invoices/subscription allocation and deployed application journeys remain separate evidence gates.
