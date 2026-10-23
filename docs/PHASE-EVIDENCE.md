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

### Standard-flow synthetic and private execution modes

New reviewed standard-only plans declare `dataMode`. The default remains `mailbox` for historical plans. `synthetic` requires `standard-mail-v1`, forbids dispatch and accepted-report selection, and uses verification admission only. All standard-flow Outlook reads must be beneath the exact mailbox guard `{"equals":["@triggerBody()?['dataMode']","mailbox"]}` or the existing exact dispatch guard. A read in the wrong branch or outside these guards is rejected before invocation. The server supplies the data mode and requires native context readback to match. Captures and evidence retain the mode; synthetic source plans, receipts or captures cannot supply the accepted final mailbox report.

Standard mailbox plans additionally declare `historyPolicy` with kind `existing-tenant-run-history-v1`, the exact delivery record ID/hash, and the independently reviewed Dataverse workflow owner ID. The release schema binds that declaration to its reviewed record. Before each private invocation the existing native `get_flow_context` reader must confirm the exact flow, pinned owner, cloud-flow category, unmanaged/customizable solution and no warning. The retained baseline contains policy and metadata hashes. It does not enumerate coowners/admins, measure retention, or assert owner-only service history. Independent review must establish the actual human acceptance of existing tenant history permissions/retention and the supported I/O/settings baseline. No new sharing or permission grants are performed. Private-data and dispatch admission remain required; this feature does not itself approve private execution.

An actual synthetic same-path run and independent evaluation of its results remain required by the workflow's reviewed phase contracts before approving a private release. Synthetic validation is not the private mailbox slice and cannot meet its report/dispatch acceptance requirement.

The v6 planning projection additionally factors repeated digest-named evidence paths. It uses `referenceFromSha256` only when the original reference exactly equals a retained literal prefix plus that receipt's own lowercase SHA-256 plus `.json`. Other paths remain literal. Prefixes, separators, case, digests, observation times and expiries are never normalized or renewed. Resolving a prompt identity grants no file-read authority. This saves repeated metadata bytes while leaving current critical prose and executable contracts whole; raw records and evidence verification continue to use the original values.

`platform_discovery({kind:"environment-rule-assignments"})` is a fixed metadata-only read for the current task's pinned environment. It uses the existing delegated account to read the documented [environment rule-assignment endpoint](https://learn.microsoft.com/en-us/rest/api/power-platform/governance/rule-based-policies/list-rule-assignments-by-environment-id) twice, refusing identity, target, response-shape or snapshot drift. It does not accept a caller URL, log credentials, log in, request consent, grant permissions or change policy. Native receipts retain the existing 60-second validity. Assignment metadata, including an empty result, is not combined classic/advanced policy evaluation, connector/action eligibility or permission to execute a private run.

Provider-generated environment and Dataverse owner identifiers use the existing Microsoft GUID validator; sequential GUIDs need not contain RFC UUID version bits. Format acceptance never substitutes for the existing exact tenant/environment/owner comparisons.


### Synthetic preparation before private execution

A standard-mail-v1 workflow can use an explicit `preparation` release purpose. Its version-2 independent integration contract declares its own nonempty `requirementIds`, checks, exact criteria, merged slice-author prerequisites, deadlines and stop conditions. This optional additional contract cannot narrow the unchanged slice or expansion contracts. It uses only synthetic data, prohibits private report capture and dispatch, and never receives first-slice credit. Quality checks and independent per-check approval remain mandatory.

After a complete independently accepted preparation run, the assigned reviewer uses `delivery_record` action `accept_preparation` with the current exact record reference and run ID. The server rehashes retained evidence and records a separate immutable preparation receipt. The normal release review request offers this closing step after the run completes. A content revision invalidates the receipt and requires fresh design review and preparation.

Standard mailbox execution requires that receipt. Before every private-data or dispatch admission, the normal runner revalidates the complete independent preparation acceptance, retained evidence bytes, record, package hash, flow definition, target and identity. Changed packages or definitions require new preparation; sample success never approves a live report or final send. The actual Inbox first slice, independent quality/report acceptance, exact report hash and single-send gates still apply.
