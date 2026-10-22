# Codex and Gemini usage collectors

## Verified contracts

Read-only installed inventory on 15 October 2026 returned Codex CLI **0.162.1** (`--version`, no session started) and Gemini CLI package **0.62.0** (package metadata). Contracts were checked against their exact upstream release commits, rather than inferred from terminal displays:

- Codex [`092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`](https://github.com/openai/codex/tree/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d): [hook identity and transcript path](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/hooks/src/schema.rs), [per-response TokenUsageRecord and token semantics](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/protocol/src/protocol.rs), and [persisted rollout serialization](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/history/src/rollout_payload.rs).
- Gemini [`b460678f3db508407554afd604cc9d6635becb2a`](https://github.com/google-gemini/gemini-cli/tree/b460678f3db508407554afd604cc9d6635becb2a): [native hook path/session identity](https://github.com/google-gemini/gemini-cli/blob/b460678f3db508407554afd604cc9d6635becb2a/packages/core/src/hooks/hookEventHandler.ts), [recording and six counters](https://github.com/google-gemini/gemini-cli/blob/b460678f3db508407554afd604cc9d6635becb2a/packages/core/src/services/chatRecordingService.ts), and [record types](https://github.com/google-gemini/gemini-cli/blob/b460678f3db508407554afd604cc9d6635becb2a/packages/core/src/services/chatRecordingTypes.ts). The [official UsageMetadata contract](https://ai.google.dev/api/generate-content#UsageMetadata) defines prompt, tool-prompt, candidates, thoughts and cached counters.

Codex completion notifications contain identity but no usage. Cumulative `token_count` events are not accepted as exact response receipts. Gemini streaming AfterModel observations omit required identity/counters and are not summed.

## Collection and attribution

`NativeTranscriptUsage` receives the current hook's absolute transcript path, session, cwd and (Codex) turn ID. It never searches global history. Codex hooks require the current generated bridge hash; Gemini retains its existing protected-profile/hash validation. Cold reattachment remains unknown because no pre-work boundary was observed. A normally resumed idle session establishes a new boundary and excludes prior responses.

| Runtime/source | Native records | Normalization |
| --- | --- | --- |
| Codex / `codex-response-v1` | Root `session_meta` plus new `token_usage_record` rows, exact thread/session/turn/root-turn and unique response IDs | Input and output as reported. Cached input and reasoning output are already included. Conflicting duplicates or unhooked new turns withhold totals. |
| Gemini / `gemini-session-v1` | JSONL metadata/full message snapshots or legacy JSON conversation; baseline and every follow-up preserve message identity/counters | Input = input + tool; output = output + thoughts. Cached tokens remain a subset of input. All new model messages need valid counters and each prompt needs new response evidence. |

The reader verifies safe integers, cache subsets, totals and aggregate overflow. It accepts bounded content-only patches to known Gemini messages without changing token receipts. It rejects unsupported rewinds, receipt-changing patches, identity drift, lost or changed earlier receipts, malformed/ambiguous JSON, incomplete UTF-8/JSONL, nonregular files and symlink paths. JSONL must retain its original prefix. Limits are 16 MiB per transcript, 20,000 records, 1,000 prompt boundaries, and 1,000 unique Codex responses; exceeding a bound withholds usage without changing native files. Gemini requires its pinned project hash to match the launch cwd hash; a legitimate different project root therefore returns unknown until explicitly supported. Native writes racing a read also withhold usage.

Only a matching terminal completion can make current, complete receipts measured. An interrupted or failed collection without that boundary remains partial/unknown even if some counters exist. Later reads cannot reconstruct an adopted busy attempt. Known subagent hook activity invalidates completeness; root transcript observations do not establish accounting for delegated or ancillary requests that never appear there. Counters describe the observed native root-session subset, not guaranteed whole-office or provider-billed work.

Both new sources have **unknown USD cost**. No price table, subscription allocation or inferred conversion is used. Persisted nonnull USD from either source is rejected. Execution reports and offline summaries require exact runtime/source pairing; older files without supported provenance remain unknown. The legacy numeric `SessionResult.costUsd` callback is not the efficiency evidence contract.

## Deployment prerequisite and remaining live evidence

Gemini's generated bridge now forwards native cwd/transcript identity. The protected administrator-installed Gemini bridge must be reviewed and updated through the existing staging/install workflow before real use. The existing verifier refuses stale protected bridge bytes; this change does not install profiles, alter permissions or restart an office automatically. Codex notify also forwards its native turn ID. Missing fields or incompatible installed versions fail closed as unknown usage.

Independent runtime QA must still run dedicated authenticated synthetic tasks for both installed providers: success, semantic failure, provider failure, retry, idle resume, cold adoption, multiple prompts, late/duplicate records and interrupted work. Correlate native root records with coordinator attempt IDs and inspect actual hook/write timing. Verify delegated work is held unknown when attribution is incomplete. Gemini must pass its native protected-profile checks. Native counters do not prove billing, savings, deployment readiness or Power Platform acceptance.

## Local verification

The final serial whole-backend run exited 0: **183 files, 3,417 tests passed**, two Unix-only tests skipped on Windows and one existing TODO. Backend branch coverage is **90.06% (12,026/13,352)**, above the unchanged **90.01%** gate. Native transcript adapter branch coverage is 88.8%; passing the global gate does not imply exhaustive path coverage. No threshold, exclusions or timeouts changed.

Global typecheck and production client/server build passed, with the existing client chunk-size warning. The isolated Chromium efficiency acceptance passed on port 4497. Package install/version/demo-start smoke passed on port 4496, with two floors, eleven fake agents and the packaged client served. The native-contract documentation is included in the npm package file list.

Independent QA's final suite contains **30 passing adversarial tests**, alongside parent acceptance tests for both native collectors, real coordinator hook wiring, runtime/source pairing, history exclusion, native bridge forwarding and evidence aggregation. Final source/documentation review reported no outstanding actionable findings.

Logs: `output/usage-collectors-coverage.log`, `output/usage-collectors-build.log`, `output/usage-collectors-e2e.log`, `output/usage-collectors-package.log`. Existing changes were preserved; there was no commit, push, live office restart, protected-profile installation or tenant mutation. Independent QA found three Gemini follow-up attribution defects (missing response, deleted intermediate response, changed counters being re-pinned). All were fixed and retained as adversarial regressions. Tests use synthetic native records and mocked CLIs; no paid coding-agent session or personal transcript was accessed.

## Authorized live follow-up

See [native usage live QA](NATIVE-USAGE-LIVE-QA.md) for completed authenticated Codex cases. See [Gemini administrator installation and authenticated QA](GEMINI-LIVE-QA.md) for the installed 0.64.0 bridge, independent native receipt comparisons, completed core live matrix and remaining provider-error gap. The local-only results above describe the earlier implementation snapshot.

See [live-gap follow-up](LIVE-USAGE-GAPS-QA.md) for the native Gemini provider-error/correction evidence, retained adoption and durable ledger hold, with precise remaining boundaries.

See [server restart and scheduler QA](SERVER-RESTART-SCHEDULER-QA.md) for actual two-server native adoption and four-process scheduler retry-hold evidence.
