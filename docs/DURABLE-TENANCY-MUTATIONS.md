# Durable authentication profile mutation ownership

Sign-in and PAC profile selection now publish an intent in
`<SWARM_HOME>/tenancy-mutation.json` before dispatching the profile-changing
operation. The bounded journal records an operation ID, a service ownership
nonce, office PID, action and timestamp. It contains no account credentials,
client secrets or authentication transcript. Publication flushes the temporary
file before atomic replacement; this is not a claim of power-loss durability for
the filesystem directory or whole process family.

A shared filesystem guard serializes inspection, intent publication and
acknowledgement. Only the original service can acknowledge the exact journal
bytes it published, with a completion scope matching the recorded action.
Sign-in acknowledgement requires the native authentication terminal callback;
selection acknowledgement follows settlement of its managed command. These are
local command/root acknowledgements, not tenant access or descendant/broker-exit
certification. Sign-in identity verification still runs separately after native
authentication returns.

A replacement service quarantines an unresolved intent. It does not infer
completion from an old PID disappearing, elapsed time, a missing authentication
job or a profile that happens to look correct. Malformed, oversized, disappeared
or changed evidence also holds admission. A failed publication prevents dispatch;
a startup exception without terminal acknowledgement preserves the intent.
Duplicate callbacks cannot acknowledge the same operation again or clear a
successor's intent.

Runtime telemetry displays the persistent operation and its reconciliation
reason. Profile discovery does not expose a current verified identity while
ownership is unresolved. New profile mutations, worker/CEO/architecture admission
and deployment capability admission remain held. The ownership fingerprint joins
worker admission context so a profile-changing operation invalidates old
readiness context. Profile changes are also refused while agent, architecture,
delivery or unresolved runtime cleanup work is active. Shutdown rejects unresolved
durable ownership instead of silently clearing it or waiting for a nonexistent
local callback forever.

No API clears this quarantine based on a user-supplied success flag or PID
liveness. Independent outcome reconciliation, including process-family/broker
uncertainty and existing profile identity, remains an implementation and tenant
acceptance requirement. This journal is a prerequisite for reliable recovery,
not completion of the full automated recovery rehearsal or isolation from
unrelated external PAC processes.

Verification on 2026-10-14:

- Filesystem/service tests cover intent-before-dispatch, exact-owner exclusion,
  changed bytes, wrong acknowledgement scope, corrupt/missing/oversized evidence,
  competing guards, failed flush, callback duplication and secret exclusion.
- A separate native process writes an intent and exits; a fresh service remains
  quarantined and preserves the bytes. Owned native fixtures continue to verify
  that callbacks follow actual root exit.
- An isolated real, non-demo server starts with a synthetic unresolved intent.
  Authenticated APIs retain workspace access, reject sign-in/handoff, preserve
  maintenance/Copilot pauses and zero active sessions, and retain the journal
  after reporting an unclean shutdown. The first probe omitted the launcher flag
  required for its IPC shutdown command; its outputs were retained and the
  corrected fixture passed. No Microsoft sign-in or tenant mutation was tested.
- Chromium displays quarantine and removes stale evidence after a read failure;
  its screenshot was inspected. Build/typecheck passed.
- The full suite passed 2,026 tests with one TODO. Backend branch coverage was
  71.06% (7,412/10,430); the unchanged 90.01% gate still failed. The broader 99.5%
  all-CI/integration completion target and complete governance/tenant acceptance
  remain unproven.

Codex remains the default; only Codex, Gemini and OpenCode are permitted. Copilot
Studio and office agent/deployment execution remain paused.
