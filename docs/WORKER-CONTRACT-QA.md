# Reviewed worker preflight publication and live QA

16 October 2026. This report covers the missing worker contract in the isolated
standard-M365 Cloud Asset showcase. Existing workspace changes were preserved.
It is not application, tenant-write or release approval.

## Changes

`server/workerPreflightInstall.ts` and the explicit source-checkout operator CLI
`scripts/install-worker-preflight.ts` publish independently reviewed exact bytes.
Publication checks the schema, bounded duplicate-free JSON, installed skill
hashes, canonical directories and the caller-supplied reviewed SHA256. Atomic
hard-link publication refuses to replace any existing destination. Final checks
verify authority, file identity and bytes; a post-publication failure retains the
installed file for inspection. No successful probe or skill observation is seeded.
Each worker must establish its own fresh readiness.
Authoring-mode preflight is a readiness gate, not a metadata-only sandbox;
session, task and tool governance still apply.

Independent installer QA found post-publication authority, discovery-mode and
replaced-file verification gaps. These were fixed with regression tests,
including replacement with identical bytes but a different file identity.

The real Codex runtime emits `mcp__swarm_flowagent__...`, although its configured
server alias is `swarm-flowagent`. The first installed contract used the dashed
qualifier and was correctly rejected by the gate. The replacement contract was
independently reviewed with the exact emitted names. No implicit normalization
or relaxation of identity assertions was introduced.

The next live attempt exposed an out-of-order identity result: the result was
recorded 3.817 seconds before authorization for the same call ID. The missing
pending correlation correctly prevented readiness. The native hook deadline was
10 seconds while the relay deadline was 30 seconds. Premature native timeout is
a supported inference, not a separately retained native timeout diagnostic.
Generated Codex hooks and their native trust verification now share a 60-second
budget (Interrupt remains three seconds). The relay still returns structured
denial after its bounded 30-second deadline. Early results remain untrusted.

## Live evidence and limits

The dedicated office is `C:\temp\AgentSwarm-CloudAsset-E2E-829bcf65`, using the
existing showcase repository and approved GraspAI site. The corrected installed
contract SHA256 is
`ae9a4077fa20adca89d7391a0ff0ce8e57af28b96b5dab00d12f82f3b323247f`.
Independent exact-byte review, installation receipts and immutable rerun
readiness/assignment records are retained there. Session evidence retains
hashes and observed readiness, rather than full returned payloads; clipped UI
summaries cannot independently reconstruct those payloads.

The contract requires three pinned Canvas/Power Automate skills, exact caller
identity, the explicit approved SharePoint connection and the approved site in
the connector catalogue. Direct native object contracts were inspected before
publication. Top-level array tools remain unsupported as readiness observations.
The site assertion uses an exact catalogue index and fails closed if ordering
changes. Metadata access does not establish mutation rights, licensing, DLP,
Canvas authoring readiness or user access.

A prerequisite attempt failed two PAC connection deadlines while the full test
suite was also running. The competing suite was stopped; a later fresh check
passed. Causation is not established. The first raw readiness response was
overwritten by the old harness; its retained summary explicitly records that
limitation. Subsequent reruns use immutable timestamped directories.

## Acceptance status

The final native attempt `91c72701-2adf-45d5-9ae7-7ae234fc5f71` reached ready
with all three skill bindings and caller/connection/site observations. Exact
allowed-pre/result sequence pairs were 14/15, 16/17 and 18/19. Independent QA
confirmed this ordering and the five boot-source hashes. Its independent
targeted suite passed all 44 tests. The capture
`worker-preflight-live-ready-proof.json` explicitly covers hook metadata, not
complete raw provider bodies or application approval.

The native attempt finished with preflight ready and runtime success. Sherlock
completed the review and rejected delivery record revision 22: no architecture
draft, exact document/hash, task plan or approved task scopes existed. Critical
entitlement/DLP, permission/resource, concurrency/recovery, approval-provenance
and Canvas verification decisions remained unresolved. The pinned repository
contained only a four-line README; referenced local evidence bytes were not
accessible through the reviewer's supported source reader.

The review API refused to persist this rejection without a valid document ID
and artifact hash. The reviewer retained the decision in its session output and
did not invent either field. This is a remaining platform gap: QA needs a typed
way to persist a missing-artifact rejection. Delivery record revision 22 remains
unchanged; the session's successful runtime outcome is not design approval.
The office was paused with zero active sessions after the review.

The final attempt reported 613,243 input and 3,635 output tokens, with complete
native attempt usage coverage and unknown cost. These are provider usage
counters, not unique context size or demonstrated token savings. Failed earlier
attempts remain retained; no claim of minimized production token usage is made.

Final whole-suite regression passed: 240 files, 4,327 tests passed, two skipped
and one existing TODO (4330 total), in 431.49 seconds. Backend branch coverage
is 90.10% (13,338/14,802), above the unchanged 90.01% gate. Type checking and
the client/server production build passed; the existing large-chunk warning
remains. Package dry-run includes this report and the worker runbook (65 files).
Logs are retained under `C:\temp\cubefarm\output\worker-contract-*`.
The independent audit is retained at the isolated office's
`independent-worker-preflight-final-audit.json`; its original audit preceded the
full regression result, which is recorded in a separate regression addendum.

No app has been deployed by this work. Deployment still requires an independently
approved current design/task/schema contract, unresolved environment and
entitlement/access decisions, supported lookup/folder/seed operations, and real
Canvas/flow publication and runtime evidence. Unchanged missing evidence must
not trigger repeated retries or fabricated approval.
