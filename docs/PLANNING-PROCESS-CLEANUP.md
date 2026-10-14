# Planning process cleanup

Codex structured planning uses a private process group on POSIX and stops the
owned process tree with Windows taskkill /T /F. Completion waits for launcher
close and the stop helper. A failed stop marks cleanup unverified even if the
launcher closes. Synthesis retains its lease and persisted cleanup record;
replacement and cold restart remain denied until ownership is resolved.
Even successful structured output cannot be published when cleanup is explicitly
unverified. Completion acknowledgement is single-use; duplicate callbacks cannot
release quarantined ownership, and progress after completion is ignored.

Tests cover a native launcher with an ordinary child whose heartbeat must stop,
a Windows helper failure after launcher close, and retained synthesis ownership.
The native fixture uses Node, not a model or tenant deployment.

This is ordinary descendant cancellation, not containment of escaped daemons.
Natural launcher completion does not establish absence of detached descendants.
Codex remains the default runtime; Gemini and OpenCode remain supported.
Copilot Studio stays paused. The live office must remain in maintenance drain.
