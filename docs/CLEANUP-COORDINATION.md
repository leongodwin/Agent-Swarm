# Native cleanup coordination

Cleanup evidence is authoritative for admission: elapsed time, transport loss and
an inaccessible PID cannot acknowledge process exit. Reader and writer failures
quarantine capacity and retain known roots.

## Queue wait and ownership

Each admitted transaction validates the bounded queue under the allocation lock.
While waiting, it observes its previously validated queue head as a readiness hint
instead of reopening every ticket on every poll. A missing ticket or dead head
only triggers another locked validation; it never grants ownership directly.
The current writer must still validate its own ticket, all queue entries, ordering
and the exclusive writer lock before reading or changing cleanup records.

This preserves FIFO admission and the 64-ticket bound. Unknown, malformed or
changed tickets remain blockers. Release validates the ticket and lock token
before deleting either. Native exit verification remains separate.

Coordination-file reads retry only Windows sharing errors (`EPERM`, `EACCES`,
`EBUSY`). They retain the existing 250ms acquisition deadline; ownership checks
on release use bounded read retries too. Missing files, malformed JSON, changed
identity and permanent permission denial do not become successful ownership
checks. These synchronous bounds are not an end-to-end latency guarantee.

## Evidence, 14 October 2026

Before this change, four diagnostic runs of the native writer tests failed twice.
The timing trace also captured `EPERM` before the acquisition deadline expired.
Queued reads repeatedly reopened immutable tickets, increasing filesystem work.
Reader failures now expose a safe system code without raw filesystem error text.

After the change, four consecutive runs of both native writer scenarios passed
(eight scenarios): two writers without injected flush delay, and three writers
with 10ms flush delay. The native trace also completed without a failed writer.
Fault tests exercise temporary/permanent sharing errors, replacement ownership,
and changed/unknown queue evidence after a readiness hint changes.

These are local synthetic coordination tests, not proof of 99.5% CI reliability,
all host/storage behavior, tenant deployment or a production latency percentile.
