# Delivery lifecycle governance — 13 October 2026

Automated delivery now requires a persisted governance decision before project build/test commands, solution import, post-deployment commands and typed actions, verification, and ongoing health acceptance. Unconfigured providers, unavailable evidence, violations, stale decisions, cancellation and provider failures block the stage. **The current production provider cannot authorize delivery:** independent package-resource extraction, advanced policy rules and comprehensive Dataverse schema validation remain incomplete. Existing standard-policy inventory and declared-column checks do not fill those gaps.

## Standard policy evaluation

`server/standardPolicy.ts` evaluates the documented classic policy shape for declared resources, using authenticated, identity-bound observations no older than 15 minutes. It handles All/Only/Except environment scope, case-insensitive standard connector IDs, explicit groups, default Business/Non-Business classification and blocked connectors. Group separation is evaluated per resource; connectors from unrelated apps or flows are not combined. Multiple policies are evaluated independently. This follows Microsoft's [connector classification](https://learn.microsoft.com/en-us/power-platform/admin/dlp-connector-classification) and [PowerShell policy interface](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-powershell#retrieve-a-list-of-data-policy-objects).

Unknown policy features, malformed scopes, duplicate groups/classifications, custom/virtual/HTTP connectors and default-Blocked exception handling yield unavailable rather than approval. Serialized input, aggregate connector work and retained diagnostics are bounded. ID format normalization is not proof of certified connector catalogue membership. Exemptions, endpoint/action restrictions and advanced connector policies require additional authoritative evidence. The evaluation result is explicitly limited to declared-resource standard classification and never sets full compliance to verified.

`createDeliveryGovernance` uses the actual cached tenant observation for the exact manifest tenant/account. It evaluates each declared connection-reference check as a single-connector declaration. A known standard classification violation blocks delivery; a passing declaration remains unavailable for overall delivery. This does not infer the complete connector set of an app or flow from its declared references. Nonempty live tenant-policy evaluation has not been tested by creating policies; no tenant policy mutation was performed.

## Stage decisions and recovery

Decisions bind phase, pinned source commit, target URL, release ID and effective manifest hash. A clear decision also requires artifact, policy and schema hashes. Package stages independently stream and hash the actual ZIP, and a clear provider result must match that digest. Hash presence is not itself proof of correct policy/schema evaluation; the complete independent provider still needs implementation and certification. Governed source and package containment, unknown embedded resources and changes after hashing remain part of the execution-broker work.

The provider receives cancellation and has a 60-second deadline. Freshness is evaluated after it returns; decisions older than 60 seconds or more than 30 seconds in the future are rejected. Exceptions cannot expose raw provider diagnostics through the saved fallback. Audit writes complete before permission is returned, and failed persistence prevents execution. Cancellation is checked again after saving.

`governance-N-PHASE.json` files are retained with the run's evidence, including blocked outcomes. Import governance precedes the import intent/checkpoint: a rejected import gate cannot be mistaken for an ambiguous import that actually started. Post-deployment checks repeat for commands, typed actions and Dataverse writes; verification repeats for commands and typed actions. Existing operation journals, target ownership, auth/binding checks and independent QA remain required.

Health observations are stored in a separate run-owned `health/` directory and linked through `health.governanceEvidence`. They do not modify the signed release evidence list or its hash. Missing/expired governance degrades health instead of silently inheriting an old approval. Read-only target inventory and Git inspection remain available to identify the blocker.

## Actual verification and limits

- 496 tests passed, one existing TODO. Full-backend branch coverage: 1,978/6,001 (32.96%); the 90.01% gate fails. No modules were removed from the denominator.
- The built isolated-office API regression passed; build/typechecking passed. The live server reloaded with Copilot pause true. Its delivery history had zero runs, so no live delivery completion is claimed.
- Delivery tests use isolated state/evidence directories and injected independent governance results. They prove orchestration rejection, stage drift checks, bound package hashes, provider timeout/cancellation, persistence and unchanged signed evidence during health failures; those injected results are not tenant governance certification.
- Classification fixtures cover scope, defaults, mixing, blocked connectors, unknown features, complexity bounds and stale/mismatched identity. Snapshot discovery was previously verified live as a one-page empty standard inventory; it expires and is not reauthenticated by GET requests.

Evidence: `.swarm-reliability/lifecycle-governance-release-coverage-2026-10-13.txt`, `lifecycle-governance-release-api-e2e-2026-10-13.txt`, `lifecycle-governance-live-state-2026-10-13.json` and `coverage/backend/coverage-summary.json`.

The full goal remains open. Authoring/architecture/merge checkpoints, certified native runtime and restricted execution paths, independent package inventories, advanced policy discovery/evaluation, complete schema rules, actual synthesis latency and sustained cross-platform pipeline reliability still require implementation and live proof. Copilot Studio remains paused.
