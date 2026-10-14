# Native Codex planning status stream

The planning adapter now decodes bounded UTF-8 JSON events incrementally and sends
fixed status messages for session, turn, composition and final-draft receipt. The
live synthesis board can show these events before process exit. Native reasoning,
session identifiers, prompt content and draft text are not copied into progress
messages. The complete structured response is still validated after process close.

Malformed stream metadata or a recognized forbidden tool event requests native
stop immediately. Completion acknowledgement still waits for close; early event
detection is not a guarantee that a vendor tool never started. Existing read-only,
no-tools, ephemeral and inherited-configuration safeguards remain unchanged. Output
keeps its accumulated byte bound, preserves split Unicode and accepts a final
unterminated JSON line. Cancelled/completed sessions cannot emit further progress.
Progress consumer failures are isolated and produce fixed warnings.

## Fresh native benchmark, 14 October 2026

An authenticated Codex CLI generated the synthetic GBP expense architecture and
implementation plan in 218,053 ms (3 minutes 38.05 seconds). Four status events were
observed before final result publication, and the isolated reservation was released
once. The server validated requirement traceability, installed-skill bindings,
structured output and the resulting artifact digest:
`24ea0a44a678133684a823f7ac41036e609ec831a909f06b62d8b43d2c31f0bb`.

The requirements included receipts on every item, server-side submission/approval,
accessible Canvas UX, solution-aware notifications, recovery and governance gates.
Copilot Studio remained paused. The artifact is an unreviewed draft with proposed
business/security decisions; it does not replace the actual Expense solution's
approved policies, account constraints or tenant verification.

This proves one isolated native case below the five-minute generation deadline.
It does not prove the workload-wide latency target, live office admission,
independent semantic/architecture approval, tenant deployment or 99.5% reliability.
The benchmark used a separate temporary project; the live office stayed drained.
No tenant data, permissions or components changed. Native CLI USD cost remains
unreported; its compatibility zero is not a measured bill.

Regression checks cover live status before close, hidden native content, malformed
events, early tool-event stop, Unicode boundaries, cancellation, final-line parsing
and callback failure. All publication and runtime-cleanup guards remain in force.
