# Persisted worker model holds

A complete, stable Codex catalogue that lacks the selected explicit model emits
a distinct unverified-model result. Startup no longer mislabels it as hook-trust
failure. An empty catalogue or malformed/provider response remains unavailable
metadata and does not manufacture a model-specific permanent hold.

Worker completion accepts a model hold only from the captured executing runtime
and captured effective model. Its runtime/model fingerprint and bounded reason
are persisted with the worker. Matching automatic scheduling and manual retries
are held without workspace preparation or fresh capability calls. Cosmetic edits
and office restart do not remove the blocker. Changing the effective runtime/model
clears that fingerprint and requires ordinary fresh readiness before dispatch.
Existing checkpoints are not moved to another coding runtime.

The CEO also distinguishes unverified model metadata from native unsupported-model
rejection while retaining its queued work. Neither condition proves subscription
capacity or live model access. Manager-facing errors remain actionable and do not
silently choose a replacement model.

Tests cover startup error propagation without task input, unavailable empty
catalogues, persisted worker retries/restart, scheduler exclusion, cosmetic edits,
fresh admission after clearing the override and unrelated rejection identities.
These are controlled lifecycle tests; all-provider circuit breaking and complete
production recovery remain open. Copilot Studio stays paused.

The first full validation run also exposed a native cleanup contention failure:
one of three concurrent writers exhausted a fixed 250 ms admission budget during
delayed flushes. Queue admission now extends that budget only on an observed
queue-head advance, with a one-second maximum waiting budget. A non-advancing
owner retains the short timeout and quarantine behavior. Native multi-process
tests retain the original 10 ms flush case and add a 30 ms case; the failed run
remains part of the validation history, not discarded reliability evidence.
