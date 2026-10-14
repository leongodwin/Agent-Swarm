# Runtime model admission

Worker creation and edits now validate the effective model that dispatch will use,
including compatible office defaults. A worker can inherit an approved OpenCode
`openai/gpt-*` or `google/gemini-*` pin and still be renamed, clear its own model or
clear an explicit CLI selection. Explicit prohibited or unapproved model values
cannot become acceptable merely because a fallback exists.

Clearing an agent CLI now validates the new selection instead of retaining the old
CLI during validation. The CEO's empty CLI resolves to Codex, and its own OpenCode
selection still requires an explicit model pin. Changing the office default to
OpenCode without a valid pin is rejected before other settings are modified.
Null, numeric, array and object model values are rejected before settings, hiring
or agent mutations, preventing partial updates followed by a type error.

An existing unpinned OpenCode office remains open for configuration repair and
reports deferred QA setup rather than failing startup or silently choosing a new
default runtime. After valid defaults are saved, missing required QA metadata is
created once; this does not start a session or resume maintenance-drained work.

## Verification

Synthetic orchestration tests confirm the exact runtime/model passed to dispatch,
inherited pins, explicit CLI clearing for workers and CEO, atomic refusal, legacy
startup and repair. These tests do not authenticate a native OpenCode account or
prove model entitlement, tenant effects or cross-platform production acceptance.

The latest observed GitHub workflow remains the older
[failed run](https://github.com/leongodwin/Agent-Swarm/actions/runs/38237608734)
at `cc6888a`: all three OS check jobs failed at npm test; E2E passed. It predates the
current local changes. Eight observed completed runs contained seven successes
and one failure (87.5% in that inspected set), not the full CI/integration target.
The current local workflow also enforces backend branch coverage above 90%; its
threshold is unchanged and still fails. Local passing tests do not replace fresh
multi-platform CI or live tenant integration/recovery evidence.

Codex remains the default; only Codex, Gemini and OpenCode are supported. Copilot
Studio stays paused. No model sessions, tenant permission changes, remote pushes
or CI reruns were performed for these tests.
