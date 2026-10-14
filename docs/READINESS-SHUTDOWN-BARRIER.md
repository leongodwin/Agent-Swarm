# Account for readiness checks through cancellation and shutdown

Cancelling a CLI startup no longer makes outstanding readiness work disappear
from capacity accounting. The process-local registry retains the actual promise
until settlement. A cancelled pending check holds execution, reload, handoff and
profile mutation through the existing shared session budget. The operations panel
shows whether a runtime is checking or cancelled while waiting for settlement.
Worker names, providers, state and hashed request identity are exposed; prompts,
credentials and hook tokens are not exposed.

CLI release closes admission immediately, cancels pending startup handles and
waits for their tracked work before releasing the keeper. Same-mode release calls
share a promise; conflicting release modes are rejected. The existing five-second
shutdown budget remains. A timeout leaves cancelled readiness visible and held;
late settlement clears the record without starting cancelled work. Restart may
preserve established CLIs, but pending startup checks cannot silently continue
past that boundary.

Capacity accounting avoids counting a known worker's readiness twice while its
agent or native cleanup already holds a slot. Cancelled readiness remains counted
after the worker's session ends, including an unlimited session budget. Snapshot
copies cannot mutate the registry. Readiness changes use the existing live
session-usage broadcast path.

Focused tests cover deferred settlement, cancellation, restart/final release,
shutdown timeout, original-token preservation, telemetry isolation, unlimited
capacity and HTTP reload/handoff holds. Initial HTTP fixtures omitted the required
process ID and failed request validation; the corrected fixtures verify the
actual holds. These development attempts are retained in the task history.

Full backend verification passed 2,153 tests with one TODO. Branch coverage was
71.46% (7,543/10,555), below the unchanged 90.01% gate. The production build and
both isolated browser cases passed. The readiness card was visually inspected;
the browser uses synthetic session telemetry, not live model execution evidence.

The registry is process-local readiness accounting, not durable process-family
termination evidence. Native descendant/broker recovery, cross-process state,
live authentication and all-tenant delivery acceptance remain separate work.
Copilot Studio stays paused; Codex remains default, with Gemini/OpenCode supported.
