# Application specification — Phase 2

The optional versioned `content.applicationSpec` extends the existing shared delivery record. It does not introduce a second plan or claim that planned tests have run. Existing records remain readable and the UI explicitly identifies records without an application specification. New loosely defined application requests should use this specification; automatic migration of accepted records is not performed. Once recorded, a later save cannot silently remove it.

## Discovery workflow

1. The CEO records the user's outcome, scope/exclusions and stable requirement IDs in the existing record. Ask material questions about users, access, integrations, approvals and intended behaviour together. Record low-risk assumptions explicitly. Unknown facts stay unknown.
2. Delegate local read-only discovery even before a target is known. Its trusted hooks permit named file reads and scoped office record/capability discovery. External platform reads need exact owner-reviewed probes. Shell, platform authoring and approval are denied in discovery/design mode. Record-only discovery does not trigger a PR-completion retry; its reported findings remain subject to independent review and issue disposition.
3. Link observed platform facts through existing finding IDs. Those findings already carry evidence references, hashes, observation/expiry times and responsible owners. Do not copy facts into a second unversioned context store.
4. Describe journeys as observable given/when/then scenarios, including relevant happy, denied-access and failure paths. Link components, shared contracts, security boundaries and verification checks to the same requirement IDs.
5. Material unanswered decisions and critical assumptions without fresh observed-ready evidence hold discovery/design approval. Discovery tasks themselves can continue collecting evidence. At this phase design approval remains record-wide; selective component approval and unaffected-task continuation are later dependency-management work.
6. The architecture synthesis catalogue includes every application section item with its own stable identity and content hash. The generated plan must cover those items as well as existing requirements. This is structural traceability; independent QA still evaluates design quality and whether clarification sources are genuine.

## Version 1 shape

The record's existing `requirements`, `contracts`, `findings`, `tasks`, `slice` and owner fields remain authoritative. `applicationSpec` contains:

| Field | Contents |
| --- | --- |
| `schemaVersion` | `1` |
| `journeys` | ID, actor, outcome, requirement IDs and scenarios with ID, kind (`happy`, `denied`, `failure`), given, when and then |
| `decisions` | ID, question, owner, requirement IDs, material flag, status (`open`, `answered`); answered decisions require answer and answerSource |
| `assumptions` | ID, statement, owner, requirement IDs, critical flag, status (`unverified`, `validated`, `rejected`) and finding IDs |
| `components` | ID, supported platform, owner, requirement IDs, existing contract IDs, component dependency IDs and finding IDs |
| `securityBoundaries` | ID, actor, allowed and denied behaviour, requirement IDs and finding IDs |
| `checks` | ID, kind (`compile`, `package`, `runtime`, `access`, `recovery`, `documentation`), requirement IDs, component IDs, scenario IDs and expectedEvidence |

Every requirement must have a journey and planned verification check. Runtime/access checks need scenario links. Links must name existing requirements, components, scenarios, contracts and findings; component dependencies must be acyclic. A check cannot use a component/scenario belonging only to unrelated requirements. Journey and section IDs must be unique; dependency/reference lists cannot contain duplicates. Empty decision/assumption lists are valid when none are unresolved or assumed; they are not automatically populated with invented answers.

Validated critical assumptions require linked findings that are observed, ready and have fresh evidence. Merely changing an assumption's status to validated cannot grant readiness. Answer references are declared sources, not automatically authenticated manager decisions; independent review must check them.

The entire specification participates in the record's existing revision/hash history. Changes invalidate design and slice approval through the existing save path. Structural link errors prevent saving. Blocked but structurally valid drafts can be saved so the manager can see unanswered questions. The delivery-plan panel displays questions, journeys, assumptions, component owners/dependencies, security boundaries and planned checks, and clears stale content when refresh fails.

## Boundaries and next phases

This is a planning contract, not automatic platform selection, schema provisioning, task scheduling, full QA-matrix enforcement or deployment approval. Legacy records retain their earlier gates and are not described as Phase 2 complete. Existing owner-only record saves and independent design-review authorization remain in force.

Phase 3 can consume component dependencies and verification links for scoped task contracts. Phases 4–5 must execute the declared checks, bind results to source/package/target and independently verify documentation and real user journeys. Phase 6 must measure accepted outcomes with explicit missing usage, rather than treating discovery completion or planned checks as a delivered app.
