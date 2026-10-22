# First-slice execution (Phase 4)

Phase 4 connects a declared first user journey to the existing delivery runner. It adds no tenant permissions or invented platform commands. For application specifications, a slice release requires explicit `firstSlice` mappings. Legacy records without a specification retain their existing gates; adopting a specification requires this stronger evidence before expansion.

## Planning contract

The delivery owner selects the smallest real journey across its data, UI, permissions and automation. Each selected journey must declare happy, denied and failure scenarios. Relevant runtime/access checks must link those scenarios to requirements and components. Existing compile/package/recovery steps and deployment controls continue to run; Phase 5 will strengthen comprehensive documentation and QA evidence.

Add this to the release plan (replace identifiers with reviewed real values):

```json
{
  "firstSlice": {
    "schemaVersion": 1,
    "components": [
      {"componentId": "expense-data", "platform": "dataverse", "targetKey": "expense-table"},
      {"componentId": "employee-app", "platform": "canvas", "targetKey": "expense-app"}
    ],
    "cases": [
      {"checkId": "expense-runtime", "scenarioId": "submit-valid", "testName": "Employee submits a valid expense"},
      {"checkId": "expense-access", "scenarioId": "deny-other-user", "testName": "Other user cannot read the expense"},
      {"checkId": "expense-errors", "scenarioId": "invalid-submission", "testName": "Invalid submission leaves no saved expense"}
    ]
  }
}
```

The plan still requires a current deliveryRecord reference with purpose slice, exact architecture and source, acceptance criteria, independent reviewer, identities, all six UX states, persistence and keyboard checks. The firstSlice testName must exactly match an executable browser scenario in the same approved plan. Different declared scenarios cannot share a test. Denied scenarios require authorization tests; failure scenarios require error-handling tests; happy scenarios require journey/persistence tests. Every relevant runtime/access check and every selected journey scenario must be mapped. Component coverage includes transitive dependencies. Task-contract projects also require current independently accepted merged task evidence for release issues.

The runner matches each component mapping to its typed manifest target. Supported mappings are Dataverse to dataverse-table, Canvas to canvas, Power Automate to cloud-flow, and Copilot Studio to copilot. Existing flow correlation, binding, publication and conversation checks still apply. Other platforms currently stop with a missing supported adapter; there is no generic shell-success fallback. API-only first slices are currently blocked because the runner has no independent denied-action adapter. Existing backend functional-development releases outside the Phase 4 first-slice contract remain supported; they cannot certify a denied user scenario, UI or least-privilege permission isolation.

## Execution and independent acceptance

The existing runner builds, tests, inventories the package, applies its approved deployment/recovery contract, checks mapped target membership and performs independent browser verification for the mapped first slice. Before QA review it writes first-slice-verification.json with the record reference, contract hash, release/plan/source/target/package binding and mapped cases. Independent observations must match test name, criterion, category and identity; browser evidence requires desktop and mobile observations. Completion time must be fresh for this verification attempt, including retries. Missing or malformed evidence blocks acceptance.

The artifact is included in the hash-bound filename-and-bytes evidence set. QA must inspect actual results, screenshots, recovery and limitations before approve_visual. The office checks the artifact again during visual approval and rehashes retained evidence immediately before accept_slice. The shared receipt stores the artifact, execution contract, record and plan hashes. An application specification cannot unlock implementation or expansion from a legacy receipt lacking this execution evidence.

Missing mappings, unsupported adapters or capabilities have an owner and remedy; correct the plan/input once, then obtain fresh review. Do not repeatedly rerun unchanged failures. Structured mapping proves coverage and provenance, not semantic adequacy: independent QA must challenge test assertions, identity privileges, resource identifiers and the actual user outcome. Local files are not a tamper-proof external attestation store. Live tenant journeys and production sign-off remain separately required.
