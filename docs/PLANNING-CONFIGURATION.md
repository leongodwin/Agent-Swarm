# Honor isolated Codex planning configuration

The isolated planning runner previously ignored the model and reasoning effort
in its session options. Explicit model pins are now passed as separate native
`--model` arguments. Reasoning effort is explicitly configured using the same
shared mapping as terminal Codex: low, medium, high, xhigh; max maps to xhigh.
Blank model selection retains the native default. Installed `codex exec --help`
confirmed the model/config arguments locally.

Planning snapshots session values and deep-copies the output schema before
asynchronous preparation. Later caller mutation cannot change the validated
model, effort, prompt or schema. Forbidden providers/models, non-exact model
identifiers and unsupported effort values fail before discovery or launch.
Read-only sandboxing, empty working directory, disabled tools, ignored inherited
configuration, structured output and native cleanup acknowledgement remain.

Backend-boundary tests verify forbidden runtime refusal, no silent Gemini/OpenCode
to Codex substitution for nonterminal work, refusal of unrestricted SDK fallback,
explicit terminal model/provider routing, keeper-failure propagation and office
process protection during desk cleanup. Planning tests cover every effort value,
pins and refusal paths, alongside the existing native fixtures. The first focused
run passed 76 checks; the full suite includes the additional immutable-input case.

Full backend verification passed 2,234 tests with one TODO. The backend routing
module reached 100% branch coverage (8/8); overall backend branch coverage was
71.61% (7,569/10,569), below the unchanged 90.01% gate. The production build passed.

These checks establish launch configuration and local boundary behavior, not live
model availability, a five-minute workload SLO or production tenant acceptance.
The full backend branch-coverage requirement is unchanged. Copilot Studio remains
paused, and Codex remains the default with Gemini/OpenCode supported.
