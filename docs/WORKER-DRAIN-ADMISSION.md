# Worker admission during maintenance drain

Initial slot checks do not authorize a future session indefinitely. The shared
worker admission check rejects new preparing work when maintenance drain is
active, including checks after awaited readiness or worktree operations and
before session dispatch. The worker becomes stopped with an explicit drain
reason, and its readiness receipt is removed.

An unlaunched QA round returns to queued with tester and tested/passed SHA fields
cleared. Existing fix-round invalidation behavior remains unchanged. Explicit
retry after maintenance must obtain fresh capability checks. Already admitted
working sessions can continue; reattachment of an existing native owner remains
distinct from launching new work.

Tests hold capability readiness, worktree preparation and idle-checkpoint
follow-up readiness, enable drain, then release those awaits. No replacement
session launches. A QA test checks queue/sign-off bookkeeping. Existing tests
cover continued admitted work and explicit resumption.

These are controlled office lifecycle tests, not a live tenant deployment or
complete native ownership certification. Copilot Studio remains paused and the
live office must remain drained throughout reload verification.
