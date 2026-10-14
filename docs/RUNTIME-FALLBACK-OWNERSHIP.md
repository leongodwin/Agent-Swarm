# Runtime fallback ownership

The worker scheduler no longer stops a working session or changes its runtime
because quota words appear in terminal prose. The owning native adapter must
complete an OpenCode session with an explicit opencodeLimit result. The completion
closure's captured CLI determines ownership; mutable worker preferences and task
text are not substitutes for that identity.

Codex and Gemini failures cannot trigger OpenCode fallback even if they carry an
OpenCode flag. An OpenCode failure containing branded quota words without the
explicit flag follows ordinary failure handling. A valid quota completion can
switch to Codex, but the next task still passes fresh capability/readiness checks.
If Codex authentication or governance is unavailable, no new session launches.
Maintenance drain blocks replacement dispatch, and a configuration change after
admission prevents quota fallback from overwriting the manager's new choices.

Tests cover live terminal prose across all three runtimes, false quota text,
cross-provider flags, valid fallback and blocked Codex readiness. These are
synthetic office/adapter tests. They do not establish real provider quota behavior,
complete descendant recovery or production reliability. Native OpenCode adapter
quota classification and all-provider circuit breaking remain separate work.
Copilot Studio remains paused.
