# Delivery startup recovery

An interrupted `delivery.lock` previously caused delivery initialization to
throw before the HTTP server opened. The office workspace, diagnostics and
recovery tools were therefore unavailable even when no delivery had been run.

The real office now starts in a restricted mode when delivery initialization
fails. `/api/runtime` reports `deliveryAvailability: unavailable`; `/api/delivery`
explicitly reports unavailable history and policy. Its empty arrays are not an
inventory or a claim that no history exists. Deployment mutations remain closed,
worker and CEO admission are blocked, architecture execution is blocked, and
Copilot policy is treated as paused until delivery is available. Maintenance
cannot be disabled while startup recovery is unresolved. Other initialization
errors, including invalid maintenance state, still follow their own safeguards.

The Solution delivery panel explains the hold and offers an authenticated,
uncached local recovery inspection. It suppresses a guessed deployment target
and disables release and deployment controls. Failed inspection refreshes remove
the previous recovery button and evidence.

Explicit recovery is permitted only when all of these observations agree:

- The marker is a valid versioned lease and its recorded process is absent.
  A live process, PID reuse, inaccessible process inspection, legacy/malformed
  marker or missing marker cannot authorize this recovery.
- A present, bounded, validated delivery state has zero runs, releases,
  blockers and recorded attempts. Missing, malformed or retained history cannot
  authorize this recovery.
- The request pins the hash of the inspected marker and delivery state.
  Repeated checks must agree under the shared acquire/release/recovery guard.
- The office and delivery service remain in maintenance mode and the service
  has not been closed or entered another recovery.

Recovery writes an audit record and moves the interrupted marker into
`<SWARM_HOME>/delivery-recovery/`; it does not delete delivery history. The service
then attempts fresh initialization without resuming agent or deployment work.
An ownership change, shutdown or initialization failure leaves admission held.
The acquisition path now uses the same filesystem guard as release and recovery.

This is a recovery path for independently validated **empty local history**.
It does not establish remote outcomes, recover retained import/post-deployment
operations, guarantee atomic isolation from unrelated filesystem writers, or
certify crash/power-loss durability. Retained cloud-operation history still needs
independent target observation before ownership can be reconciled; it must never
be cleared merely because a local PID ended. The full cross-environment recovery
rehearsal remains a separate acceptance requirement.

Validation on 2026-10-14:

- Filesystem/service/API tests cover preserved markers and history, competing
  owners, changed generations, malformed/missing/retained state, shared-guard
  exclusion, authenticated inspection, strict request shape, maintenance holds
  and shutdown during recovery.
- Headless Chromium verifies disabled deployment controls, visible recovery,
  removal of stale evidence after failed reads, and refreshed status following a
  simulated recovery. The recovery panel screenshot was inspected visually.
- An isolated real, non-demo server was started with a synthetic interrupted
  lease and empty delivery history. Authenticated API calls verified workspace
  availability, refused maintenance exit, recovered the local lease, retained its
  marker, kept maintenance/Copilot paused and zero active sessions, and then
  shut the fixture down cleanly. This was not a tenant deployment or auth test.
- The full backend suite passed 1,971 tests with one TODO. Build/typecheck passed.
  Backend branch coverage was 70.72% (7,270/10,279); the unchanged 90.01% gate
  still failed. Neither that coverage target nor the 99.5% all-CI/integration
  completion target is achieved.

Codex remains the default; Codex, Gemini and OpenCode are the only permitted
coding runtimes. Copilot Studio integration remains paused.
