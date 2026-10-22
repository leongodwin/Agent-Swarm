# Phase-specific execution evidence, version 1

When whole captured evidence texts cannot fit, each affected entry is marked `status: "unavailable"` and `textOmitted: true`. A single `capturedEvidenceOmissionRule` states that the model must not infer those texts. Original identities and pre-existing failure reasons are retained; fitting texts remain whole. A `sourceEvidenceIndex` may link only the exact reference and digest to an existing same-prompt evidence-pool entry. `capturedEvidenceIdentityRule` forbids inferring freshness, approval or readiness from that link; unmatched identities remain literal. Original source verification still uses the unmodified capture. The source files and the 256 KiB limit are unchanged.

Design approval approves requirements and named validation contracts. It cannot certify that a sixty-second authentication or connection observation remains current throughout synthesis and independent review.

The supported headless-flow host can explicitly classify a **narrow metadata prerequisite** using `finding.executionEvidence`. All existing findings retain their evidence, timestamps, conclusions and history. No existing record is automatically classified. Independent QA must assess each classification and its rationale before design and task approval. Unclassified findings keep the existing discovery rules, including freshness requirements. Broad privacy, effective DLP, licensing eligibility, inference feasibility and quality findings must remain separate; these probes cannot resolve them.

An example contract is:

```json
{
  "schemaVersion": 1,
  "probe": "headless-authoring-rights",
  "configurationSha256": "<exact 64-character SHA-256 of the reviewed capability configuration>",
  "maxAgeMs": 60000,
  "designRationale": "Explain this narrowly scoped metadata prerequisite, why it is checked immediately before execution, and which substantive design requirements remain separately evidenced."
}
```

Only version-2 task plans with flow-only components support this feature. Classification must be critical and in a compatible discovery area. Optional application assumptions can explicitly use `validationPhase: "execution"` only with status `unverified` and linked typed contracts. This records a required future check, never a validated fact. Other assumptions and material decisions keep their existing approval requirements.

The fixed probes are `project-readiness`, `headless-authoring-rights` and `private-report-acl`. The server runs its existing native observers, under the owned session, against the exact pinned Outlook and Dataverse connections and configured identity and environment. Caller-provided results, commands or receipt paths cannot grant admission. There is no generic probe execution API.

Checks run before worker authoring tools, delivery lifecycle operations, headless verification and each private-data or final-dispatch trigger. Every grant binds the immutable record/source/target, independent design review, task scope/reviews/acceptances, execution phase and attempt, authentication profile and configuration, and all classified contracts. Ownership, approvals, maintenance state, target and configuration are rechecked after asynchronous observations. Adverse, missing or expired observations refuse the operation.

Receipts are immutable hash-named metadata files in the office's `execution-admission` directory, outside the planning record. They retain the original observation and expiry, with a maximum sixty-second window. Reuse verifies exact receipt bytes and original expiry using wall and monotonic clocks; a restart does not adopt saved grants. `capability_status` exposes retained metadata snapshots with their original times, hashes and references, not new observations or approvals.

These receipts establish only their fixed metadata preconditions. They do not establish effective DLP, private service-history protection, actual inference, report quality or delivery. Existing source/identity, independent design and task reviews, release, governance, private capture, accepted-report equality and persistent no-resend safeguards remain required. Read-only reconciliation of an existing uncertain dispatch retains its original ownership and no-replay rules.

Read `EXECUTION-ADMISSION-CONTRACT` through the bounded source reader for the installed implementation. This guidance and synthetic tests are not tenant runtime acceptance.

To keep planning input bounded, the model receives an explicit index of prose omitted from noncritical findings and typed execution findings. Every finding identity, criticality, conclusion, original evidence identity/expiry, full-finding byte count/hash and complete execution contract remain in its input. Unclassified critical findings remain whole. The full record is retained for independent QA; omitted prose is explicitly uninspected, and no classification or conclusion is changed by this input projection.

Repeated byte-identical receipt objects are represented once in a planning-only `evidencePool`. Every finding retains ordered `evidenceIndex` links to the complete original objects. Receipts with differing paths, hashes, observation times or expiry times remain distinct. This is lossless input representation, not deletion, renewal, validation or a change to the retained record. Independent admission and QA still use the original full record.

### Headless verification task and report boundaries

The runner passes the approved `maxTaskDurationMs` (at most 120 seconds) into each headless check. Every provider call during that check is bounded by the same deadline. A timeout bounds the host's wait; it does not cancel a cloud run or prove its outcome.

Before invocation, an exclusive persistent hold is created for the owner, tenant, environment and flow. A missing response, timeout or unverified terminal identity preserves the hold across attempts and restarts. Further triggers are refused. Exact terminal-run evidence is archived before the hold is released. Original-operation read-only reconciliation is required for an unresolved hold; there is no automatic replay or timeout-based release.

Private report capture requires nonempty text and keeps the existing size and protected-folder checks. A reviewed `operationScope: "standard-mail-v1"` excludes AI, Dataverse and attachment downloads. Historical plans retain their legacy operation scope; current standard-only designs must explicitly select the new scope. None of these host checks establish tenant run-history privacy, licensing, effective DLP, successful runtime execution or independent acceptance.
