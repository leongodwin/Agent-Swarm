# QA and documentation evidence (Phase 5)

New releases pinned to an application specification require `qualityEvidence` schema version 1. Legacy plans remain readable without rewriting hashes. They do not gain Phase 5 assurance: implementation/expansion for an application specification needs an independently accepted quality receipt. To upgrade, save a revised specification/check matrix, obtain fresh design review and create a new scoped release; do not patch saved approval history.

## Planning and handover

Map every declared release check by its exact ID and kind. Slices use selected requirements and component dependency closure; expansion uses the complete application specification. Each required requirement/component needs compile, package, runtime, access, recovery and documentation checks. Multiple requirements/components may share a well-scoped check. Every selected journey needs happy, denied and failure scenarios. Runtime/access mappings must link declared scenario IDs to exact executable browser test names. Access mappings require authorization scenarios. The first-slice and quality mappings must agree.

The qualityEvidence contract contains `schemaVersion`, `components` (componentId, targetKey, platform, matching the first-slice map when present) and `checks`. Check bindings are:

| Kind | Binding and retained evidence |
| --- | --- |
| compile | `checkId`, `kind`, `phase` (build/test), `commandIndex` (zero-based manifest index). Successful runner command receipt and captured stdout are retained. |
| package | `checkId`, `kind`. Target solution inventory, acceptance scope and the exact deployment package digest. Existing package-content checks remain required. |
| runtime / access | `checkId`, `kind`, `cases: [{scenarioId,testName}]`. Actual independent browser observations at desktop/mobile sizes with matching criterion, category and identity. |
| recovery | `checkId`, `kind`. Existing validated rehearsal, runbook and prior inventory, bound to source/runbook and package context. |
| documentation | `checkId`, `kind`, `document: {role,file,sections}`. Retained UTF-8 Markdown from the exact pinned Git commit, with declared headings; QA must assess the actual content. |

Declare one documentation check/file for each role: user, administrator, operations and architecture. Files must be distinct contained relative .md paths, listed in the committed delivery manifest, nonempty and at most 1 MiB each. Sections are explicit required Markdown headings. Plan useful content: user tasks and error handling; administrator configuration, access and deployment; operations monitoring, troubleshooting and recovery; architecture components, data/interfaces, decisions and limitations. Headings or generic template text do not establish substantive completeness. Independent QA must withhold approval when content is incomplete, inconsistent with deployed behavior, or unsupported by evidence.

A minimal check binding example (include the remaining kinds and all four documents in a real contract):

```json
{
  "checkId": "user-guide",
  "kind": "documentation",
  "document": {
    "role": "user",
    "file": "docs/user-guide.md",
    "sections": ["Submit an expense", "Correct validation errors", "Known limitations"]
  }
}
```

Unsupported typed platforms remain blocked. API-only Phase 5 quality acceptance remains blocked pending a genuine runner-owned denied-action adapter; existing non-Phase-5 functional backend verification retains its explicitly limited scope.

## Execution evidence and retries

The office validates component, executable-command and document bindings before deployment. It reads document content via `git show <pinned head>:<path>` before storing a release and again when retaining handover evidence, so generated or modified checkout files cannot silently replace the approved source document. Symlinks are read as committed Git objects, not followed into external files. Missing headings, files, commands or target mappings stop execution.

Successful build/test returns create runner-owned quality-command receipts with source, manifest, command hash, originating retained attempt ID, timestamp and captured-output hash. Failure creates no successful receipt. A retry may reuse an already prepared package and its original command receipts when source, manifest, origin and package digest still match; no redundant compile/model loop is required. The receipt's original execution time must be within its retained attempt and before the current verification. This is provenance, not a claim that any arbitrary command constitutes a real platform compiler: QA must inspect the chosen executable, arguments, output and expected evidence. Native compiler/App checker/runtime assurance remains platform-specific.

After existing build, test, package, recovery, deployment and independent verification succeed, the office writes quality-evidence.json. It contains the exact record, release/plan, source, target, package and manifest binding, each check's artifact paths/hashes and per-check evidenceSha256. Pinned document snapshots, command receipts, captured stdout, manifest and index join the hash-bound evidence set. Missing, failed, stale or mismatched evidence prevents review readiness. Checks remain unapproved until independent assessment.

## Independent QA

The assigned independent QA session reads the index and actual artifacts, source requirements and expectedEvidence. It examines every screenshot/result and the full handover documents. In the existing approve_visual call, pass `quality_decisions` with one row per exact check:

```json
{
  "checkId": "user-guide",
  "evidenceSha256": "<exact row hash from quality-evidence.json>",
  "decision": "approved",
  "notes": "<specific assessment of the actual artifact, behavior coverage and remaining limits>"
}
```

A decision needs at least 40 characters of substantive notes. Missing, duplicate, rejected, unknown or stale decisions refuse completion. The session identity is captured by the office; authors cannot approve themselves. Withhold approval and route findings when a check is inadequate; the approval operation does not silently convert a rejected decision to success. The run remains reviewing until issues are resolved and current evidence is independently accepted.

Before committing approval, the office rehashes retained bytes, reconstructs the index and rechecks the run/release/attempt state. A concurrent retry or changed evidence prevents approval. Saved per-check QA decisions survive restart and are validated against the plan, result and independent evidence hash. Before accept_slice the office reconstructs and rehashes evidence again. The resulting shared receipt carries quality contract/artifact hashes and reviewer identity; old execution-only receipts cannot unlock application-spec expansion.

This is local hash-bound provenance and mandatory independent assessment, not a cryptographic signature or an external tamper-proof store. Browser identity labels do not establish least-privilege permissions. Synthetic orchestration tests do not prove real tenant authorization, compilation, deployment, documentation adequacy or user outcomes. Actual token/retry savings are not measured by this phase.
