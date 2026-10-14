# Publish readiness only after evidence acknowledgement

Capability checks formerly marked results live and cached them before saving the
evidence file. A failed save could therefore be followed by a cached ready result
that had never been acknowledged. Configuration updates likewise became visible
before their publication completed.

Configuration and observation publication now share the serialized writer. The
next snapshot is saved before live configuration, fingerprints, results or cache
entries change. Failed publication clears live/cache authority and exposes a
storage-unavailable reason while preserving prior acknowledged file bytes.
Repair requires a fresh acknowledged configuration/check; the failed observation
cannot be reused. Configuration is rechecked at the publication boundary, and
expired or closing observations cannot grant readiness. Deduplicated callers get
independent copies of results.

Startup capability JSON now uses bounded duplicate-key rejection and fatal UTF-8
decoding within the existing 4 MiB allowance. Historical observations still cannot
authorize readiness after restart. The delivery panel shows a storage-specific
hold, disables new runs, and keeps readiness refresh and pausing available.

All 74 focused capability, admission and production HTTP checks passed. Filesystem
fault fixtures cover failed publication, failed configuration, acknowledgement
delay, queued configuration changes, expiry, shutdown and caller isolation. The
initial shutdown fixture expected a clean close after failed publication; it was
corrected to require the actual rejection. Development failures remain in task
history.

Full backend verification passed 2,287 tests with one TODO. Branch coverage was
71.92% (7,663/10,654), below the unchanged 90.01% gate. The production build and
isolated browser check passed. The browser used synthetic unavailable-storage
telemetry; its visible repair message and disabled run controls were inspected.

These checks establish local readiness publication boundaries, not comprehensive
tenant schema/DLP compliance, model availability, cross-process registry ownership
or production acceptance. Copilot Studio stays paused. Codex remains default,
with Gemini/OpenCode supported; the full backend coverage gate is unchanged.
