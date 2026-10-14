# Agent hook and MCP JSON boundaries

Hook requests and MCP transport requests now reject duplicate decoded object keys
before dispatch. Literal and escaped spellings of the same key are ambiguous and
produce a generic HTTP 400 response without echoing input. Browser requests use
the same verification step. Session tokens, origins, schemas and admission checks
remain independently required.

The verifier scans strings linearly to support large screenshot values without
regular-expression stack exhaustion. It inspects key multiplicity, container
depth and syntax-token bounds without constructing values. Express subsequently
validates JSON grammar and builds the request object once. The verifier alone is
not a complete JSON parser.

Existing body allowances remain: hooks 64 MiB, MCP 4 MiB, browser API 1 MiB.
The shared parser defaults to 32 MiB and permits an explicit allowance up to
64 MiB; depth and syntax-token ceilings remain 256 and 2,000,000. A 33 MiB
hook fixture verifies compatibility with the larger existing hook allowance.

On 2026-10-14, 79 focused tests passed and the full backend suite passed 2,079
tests with one TODO. Backend branch coverage was 71.16% (7,440/10,454); the
unchanged 90.01% gate failed. Type checking and the production build passed.
The isolated HTTP smoke test passed, including ambiguous hook and MCP requests.
These local checks do not prove live tenant deployment, permission isolation,
full recovery or the all-CI/integration reliability target. Copilot Studio remains
paused. Codex is the default; Gemini and OpenCode are the other permitted providers.
