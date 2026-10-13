# Cloud-flow adapter cleanup acknowledgement

The installed MCP stdio transport can return from close after requesting termination, before its child close event arrives. The previous adapter also skipped transport closure if client closure threw and let abort-triggered close rejection go unobserved. The adapter now joins concurrent cleanup, attempts both client and transport closure, bounds each operation and requires the owned transport's onclose acknowledgement after connection launch was attempted. Cleanup failure remains explicit rather than authorizing success.

Adapter calls are refused after close begins, and results arriving during cancellation/closure are not accepted. Connection failures preserve both their original cause and cleanup failure. Abort-triggered cleanup owns its rejection; the delivery runner's explicit close/finally observes cleanup failure. No PID inference, port-based termination, unrelated process kill or automatic replacement runtime is added.

Each close operation and exit wait is bounded at five seconds by default. A timeout does not acknowledge exit: the adapter remains closed to requests, and direct cleanup can be retried after a later exit event. The owned adapter wrapper retains its failed close result; broader durable reconciliation of every adapter runtime across office restart remains separate work. A root close event does not prove descendant cleanup or cancellation of an already-issued remote HTTP mutation.

Existing workflow journals still determine whether an uncertain publish/disable action can be reconciled from fresh target state. These cleanup changes do not repeat cloud mutations, bypass ownership, waive reference/runtime binding checks or resume Copilot Studio.

Focused verification: 26 tests passed across cleanup, owned adapter, flow binding and platform lifecycle tests; build/typecheck passed. An owned Node subprocess fixture verifies actual process-close acknowledgement after a stop request. Other tests cover joined cleanup, both cleanup failures, stuck client closure, unacknowledged timeout, later exit and unstarted cleanup. No tenant request or actual FlowAgent authentication was used. Evidence: ignored `.swarm-reliability/flow-cleanup-tests-final.txt`, `flow-cleanup-build-final.txt` and `flow-cleanup-coverage.txt`.

The full production goal remains active. Comprehensive governance, sustained CI/integration reliability, complete runtime recovery, real-model latency and greater-than-90% backend branches remain required. Codex stays default, office maintenance drain is preserved and Copilot Studio remains paused.

Full verification: 1,309 tests passed, one existing TODO across 110 files; build/typecheck passed. Whole-backend branches are 5,804/8,962 (64.76%), failing the unchanged 90.01% gate. Actual tenant FlowAgent authentication/recovery was not exercised by this batch.
