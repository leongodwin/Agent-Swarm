# Sign-in confirmation and native cleanup

Sign-in formerly became `completed` solely when the PAC authentication process
reported a zero exit code. The resulting active account and environment were not
checked. The browser also changed a pending request to failed after a temporary
status-read error, abandoning observation of a request that could still be live.

The service now keeps the job pending in a `verifying` phase after authentication
returns. It independently reads the active PAC profile, calls `pac org who` for
that exact organization root, then reads the active profile again. Completion
requires one identifiable account/environment, agreement with any requested
environment, agreement with the organization observation, and an unchanged
profile index, account and environment across confirmation. Requests use argument
arrays and do not change the selected profile during verification.

Wrong, ambiguous, missing, changed or failed observations leave the request
failed with `ok: false` and no accepted observation. A cancelled, expired, closed
or superseded job cannot accept a late result. The original input is copied and
returned observations are copied, preventing caller changes from altering the
verification scope or the retained receipt. PAC-reported error lines are latched
even if the transcript is later truncated or the process exits with zero.

Sign-in environment inputs must be credential-free HTTPS organization roots.
Paths, query strings, fragments and non-default ports are rejected by the HTTP
contract and service before native authentication starts. The browser displays
the confirmed account and environment with readable contrast and explains that
PAC identity is separate from tenant policy, licences and delivery permissions.

Cancellation and expiry do not imply native exit. Profile mutation and discovery
authority remain held while authentication cleanup awaits the native root's exit
callback. A process error with an existing root identity also does not imply
exit; a spawn failure with no root identity is terminal. Tenancy status exposes
the hold, and the interface provides a profile refresh action. This guard is
process-local and does not certify descendant/broker exit, persist authentication
cleanup across office restarts, or serialize unrelated external PAC processes.
Those are separate remaining reliability requirements.

The status reader retains and polls the same handle after temporary read errors.
It does not restart authentication automatically. A server 404 establishes that
the handle is missing and stops observation. Other failures preserve the pending
request and its cancellation route. Credentials and raw verification failures
are not returned in the accepted observation or failure message.

Verification on 2026-10-14:

- 83 focused tenancy/platform-auth tests passed, covering wrong profiles,
  native organization mismatch, changed generations, caller mutation,
  cancellation/expiry/shutdown, cleanup errors, reported failures with zero exit
  and unsafe input rejection. Native-runner tests use controlled process events;
  they are not evidence of a real Microsoft sign-in or process-family containment.
- Two Chromium tests verify observation through a transient status-read failure,
  confirmation-only identity display and termination on a missing handle. An
  initial test used an exact-text locator for text contained inside a larger
  paragraph; its failed log/trace was preserved and the locator corrected. Visual
  inspection then found low contrast, which was corrected and rechecked.
- The full suite passed 1,997 tests with one TODO. Build/typecheck passed. Backend
  branch coverage was 70.90% (7,317/10,320), below the unchanged 90.01% gate.
  This does not prove the 99.5% all-CI/integration completion target.

No Microsoft sign-in, profile change, tenant mutation or deployment was requested
by these checks. An accepted receipt has `pac-profile-and-organization` scope:
it is not proof of tenant identifier/application identifier agreement, connector
access, DLP compliance, licensing or end-to-end delivery acceptance. The existing
independent platform-identity and lifecycle governance gates remain required.

Codex remains the default, with only Codex, Gemini and OpenCode permitted.
Copilot Studio remains paused and the live office remains in maintenance mode.
