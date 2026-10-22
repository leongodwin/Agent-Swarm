# Execution efficiency (Phase 6)

Agent Swarm records coordinator reservations before asynchronous preparation, native launches and terminal outcomes in `execution-ledger.jsonl`. The metadata contains hashes and bounded identities, never prompts, tool payloads or credentials. Native session evidence is linked by coordinator attempt ID, worker, role and runtime. A model-reported success is separate from an independently reviewed merged-task receipt. Accepted tasks are not deployed applications.

## Retry limits

The automatic developer and QA schedulers share a durable cap of three reservations per repository, issue (or unassigned QA), execution role, reviewed scope and admission configuration. Developer issue and repair attempts share their budget. Automatic no-PR continuations also consume it. Reservation is synchronous, so pending checks consume capacity. Restart preserves the budget and marks unfinished attempts interrupted. An explicit manager retry can exceed the count; it still requires writable intact telemetry, normal readiness and QA authority. Scope/configuration changes establish a separate budget. Existing preflight backoff and QA round controls remain in force.

A manager Send to QA request creates one in-memory retry permit for that queued record. Automatic queueing does not create one. Selection consumes the permit even if storage or readiness refuses the attempt; it cannot authorize a later automatic retry. Unused permits are discarded on restart. Scope, ownership and storage checks still apply.

## Measurement

Operations and tool audit exposes a repository-specific read-only report and metadata export. Both authenticated endpoints reject disconnected repositories and use `Cache-Control: no-store`. Reports cover a rolling 30-day retained collection. The export includes terminal events only for attempts in the requested repository. Missing, corrupt or absent observations never become zero usage.

OpenCode's current-prompt assistant message counters supply input, output, reasoning, cache work and optional provider cost. Prompt IDs deduplicate repeated snapshots. Provider message shape or missing counters produce unknown usage; cumulative retained-session status cost is never used as attempt cost. Adopting a process already busy before the coordinator attempt reports unknown usage because its current prompt can predate the attempt. Codex and Gemini native token collectors use versioned root-session receipts with strict prompt/session boundaries; their USD costs remain unknown. See [verified native contracts and live-evidence requirements](NATIVE-USAGE.md). This adapter has synthetic protocol tests; live installed-provider compatibility remains unverified. Contract reference: https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/session

Finished coordinator attempts that never launched native work have known zero model usage. Launched attempts need complete correlated native evidence. Measured totals are an explicitly partial subset, not whole-office totals. Per-accepted-task metrics include all retained same-scope attempts before the receipt; an earlier out-of-window or missing attempt withholds that task's ratio. Current receipts require the same reviewed task authority, PR/head, evidence and independent reviewer. Stale acceptance is historical only. CEO/synthesis work and requests rejected before reservation are outside this collection. No token savings, invoice cost or production reliability claim follows from these metrics.

## Retention and recovery

The ledger stops at 10,000 events or 8 MiB. It does not silently prune history. Corruption, changed bytes, symlinks or write failure holds new reservations and reports unavailable. Preserve the raw ledger and session-evidence directory before recovery. Export while healthy and archive deliberately; deleting/archiving starts a new collection and forfeits prior completeness and budgets. The local ledger is an operational record, not a tamper-proof audit store or multi-process writer service. Only one office process may own its home. No live tenant acceptance or billing reconciliation is implied.

## QA publication outages

Native/model completion is not QA publication or independent acceptance. If required screenshots or the QA comment cannot be published, Agent Swarm preserves the observed report and tested head but holds the PR for human review with no approved head. It does not count publication outages as code failures or automatically rerun development/QA models. Restore publication permissions and reconcile the retained observations against the current PR head and independent owner before approval. See [blocker remediation QA](PHASE-6-BLOCKERS-QA.md).

The read-only offline session summary now shares strict file/identity/terminal validation with dashboard ingestion. Unproven legacy counters and unavailable costs remain unknown; malformed evidence cannot provide a successful or measured denominator.
