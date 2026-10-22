# Phase-specific execution evidence, version 1

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
