# Worker recovery display

Worker snapshots and update events now include current recovery advice. Model holds show the model failure and a configuration repair step. Readiness failures show consecutive failures and the next automatic retry eligibility time, or an exhausted retry hold. Fingerprints remain private. Busy workers and obsolete configuration contexts do not expose a stale recovery panel; clearing sends an explicit null.

The terminal computes eligibility from the timestamp on its existing clock refresh. Eligibility does not assert execution: maintenance drain, capacity, dispatch and fresh readiness checks still apply. The panel does not initiate retries or change the persisted backoff policy. CEO recovery remains on its separate existing path.

Validation on 14 October 2026:

- Focused lifecycle and server-rendered display checks: 195 passed.
- Full suite: 1,822 passed, one TODO. Backend branches 69.59% (6,886/9,895); the unchanged 90.01% gate fails.
- Production build passed.
- Isolated Chromium synthetic WebSocket test passed: scheduled and due eligibility, replacement with a model hold, and removal after a working-agent update. No live office tasks or tenant records were created by that test.

This change does not prove live provider entitlement, tenant end-to-end delivery, complete process recovery, or the 99.5% reliability target. Execution remains limited to Codex, Gemini and OpenCode, with Codex the office default and Copilot Studio paused.
