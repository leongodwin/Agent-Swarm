# OpenCode rate-limit ownership

The CLI adapter no longer treats quota words in an OpenCode terminal screen, response, or arbitrary error message as evidence for automatic fallback. A rate-limit flag now requires an announced, matching root session and a native `APIError` with numeric HTTP status 429 and declared boolean retryability. Unknown, child and unbound sessions cannot trigger completion or fallback. A zero-exit completed response quoting quota language remains successful; ordinary turn failures remain failures on process exit.

The generated plugin announces its root before publishing errors and completion. A resumed session is pinned by the office's launch environment. Child sessions are excluded. Forwarded native error fields are limited to name, status and retryability; the message is bounded to 1,000 characters, and response bodies and headers are not forwarded. Existing generated-plugin digest validation retires retained terminals with an older plugin.

This uses OpenCode's [official native error schema](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/v1/session.ts). HTTP 401 and 402 are not classified as rate limits. Codex fallback still requires the existing owning completion, unchanged configuration, fresh capability admission, available capacity and an office outside maintenance drain.

Validation on 14 October 2026:

- Focused classifier, actual generated-plugin evaluation and adapter authority tests: 60 passed before adding the completed-response regression.
- Full suite, including that regression: 1,840 passed, one TODO. Backend branch coverage 69.85% (6,932/9,923); unchanged 90.01% gate fails.
- Production build passed; installed native OpenCode version reports 1.18.35.

The event tests use synthetic native process/provider callbacks. No live provider quota was exhausted, inference requested, tenant record changed, or office task launched. Installed-version discovery does not certify live quota handling. Full provider authentication/circuit-breaking and the 99.5% all-CI-and-integration target remain unverified. Copilot Studio stays paused.
