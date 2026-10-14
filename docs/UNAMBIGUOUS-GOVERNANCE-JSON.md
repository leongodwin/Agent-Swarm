# Unambiguous governance JSON and cleanup contention

The package inspector formerly used ordinary `JSON.parse`, which silently keeps
the last duplicate property. A checksum-valid flow could therefore contain two
`actions`, connector or table fields while the scan saw only one interpretation.
The same ambiguity could hide an active authentication intent with a second
`active: null` field.

A shared parser now rejects duplicate decoded property names, including escaped
Unicode spellings, before constructing the object. It also bounds UTF-8 bytes,
container depth and syntax-token count. Invalid input errors do not echo keys,
values or parser excerpts. It preserves valid JSON behavior for distinct
case-sensitive keys, repeated keys in separate objects and punctuation inside
strings. Consumer schema, identity and policy checks still apply separately.

The parser is used for packaged flow definitions, nested Canvas datasource JSON,
deployment settings, durable authentication journals, FlowAgent JSON text
responses and browser configuration request bodies. Existing per-consumer size
limits remain in force. The settings depth limit remains 64; package/response
parsing permits 256 containers so it preserves the previously supported 32-level
flow-operation nesting even when Switch wrappers use multiple JSON containers.
Agent hook and MCP transport envelopes retain their existing parsing paths; this
change is not a claim that all JSON interfaces or governance semantics are complete.

Actual ZIP fixtures verify that ambiguous flow/Canvas metadata cannot produce a
complete inventory. All six lifecycle gates retain unavailable package evidence
before policy observation. Provider response tests reject ambiguous success and
identity fields, and authenticated HTTP tests reject ambiguous policy changes
before calling the mutation service. Journal tests reject duplicate active fields
instead of presenting an interrupted authentication operation as clear.

The first full-suite run also exposed native cleanup contention and timing
failures. Cleanup coordination now uses its existing full one-second cap before
reporting contention, rather than failing after an initial 250 ms window. Release
coordination uses the same bound. FIFO ownership, exact-token validation,
identity checks and quarantine on failure are retained; waiting never acknowledges
exit or authorizes takeover. The tradeoff is up to one second of synchronous
coordination blocking per acquire/release operation.

A new owned native-writer fixture exercises 350 ms flush latency. Planning-fixture
directory removal retries transient filesystem deletion, while its stopped-leaf
heartbeat assertion remains. Synthesis tests wait for acknowledged publication;
the application's five-minute deadline is unchanged. A two-run delivery test has
a realistic verification budget and retains all outcome/evidence assertions.
The original five-failure full-suite log is preserved alongside the subsequent
targeted repair results, not counted as a clean run.

These are local/source/provider-contract checks. They do not certify Microsoft
import behavior, all CI/integration clean-run reliability, complete DLP/schema
coverage, tenant permissions or the full recovery rehearsal. Copilot Studio
remains paused; only Codex, Gemini and OpenCode are permitted, with Codex default.

Final backend verification on 2026-10-14 passed 2,069 tests with one TODO.
Branch coverage was 71.11% (7,422/10,437); the unchanged 90.01% gate failed.
The repaired native/timing groups passed 185 focused tests, including the 350 ms
flush case. These later passes do not erase the original failed run or establish
the 99.5% all-CI/integration target.

HTTP smoke verification also caught a profile-change guard applying to synthetic
demo login. Demo login changes no credentials, so that distinction was corrected
while retaining real-office activity restrictions. The failed browser log/trace
was preserved; real-office HTTP tests and the corrected smoke test passed.
