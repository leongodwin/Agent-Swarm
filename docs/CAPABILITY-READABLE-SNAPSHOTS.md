# Keep published capability evidence restart-readable

Capability startup rejected snapshots above 4 MiB, but publication could write
larger state. Publication now validates the complete next snapshot with the same
schema, UTF-8 byte limit and JSON processing bounds before atomic acknowledgement.
Oversized, too-deep or invalid candidates cannot replace the prior readable file,
change accepted configuration fingerprints or enter live/cache authority.

Failure diagnostics distinguish storage access, processing/size limits and invalid
observations without exposing source data. The delivery panel offers a matching
repair message while keeping new runs held. Freshness markers are deduplicated in
status views so an already expired observation does not acquire repeated markers.

All 77 focused capability/admission/HTTP checks passed. An aggregate Unicode fixture
stores six individually valid project configurations, refuses the seventh by UTF-8
bytes, verifies unchanged acknowledged bytes/fingerprint and successfully reloads
the prior state in a fresh service. Reducing configuration size permits fresh
publication. Additional fixtures cover excessive nesting and malformed probe output.

These are local persistence and readiness boundaries, not tenant schema/DLP
certification, native process-family recovery or production acceptance. Copilot
Studio remains paused; Codex remains default, with Gemini/OpenCode supported.

The shared JSON verifier now skips plain scalar contents with native substring
search while retaining escaped-quote parity, decoded duplicate-key detection and
all existing limits. A regression fixture exercises even and odd escape runs.
The initial two full-suite attempts exposed the large snapshot fixture's costly
per-element buffer comparison; a native byte-for-byte Buffer.equals assertion
retains the same data, expectations and 15-second budget. Those failed attempts
remain recorded locally. The final full suite passed 2,291 tests with one existing
TODO. Backend branch coverage is 71.93% (7,662/10,652); the unchanged 90.01%
coverage gate still fails, so this batch does not satisfy the overall goal.

The browser matrix covers storage, limit and invalid-record diagnostics against
an isolated demo office. Its initial storage case passed functional assertions
but failed screenshot stability; disabling animations during capture preserves
the functional checks. This is synthetic UI evidence, not live tenant validation.

The final isolated browser run passed all three cases; its build and typecheck
passed. Cropped limit and invalid-record alerts were visually inspected.

