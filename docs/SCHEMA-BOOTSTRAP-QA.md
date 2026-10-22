# Schema delivery boundary — 18 October 2026

The CloudAsset delivery record previously required new SharePoint list/column IDs before creation and global Canvas/flow/runtime feasibility before the schema step. Those unresolved application requirements have not been marked ready or removed.

## Restricted architecture/task review

`schemaBootstrap.ts` and `schemaBootstrapRuntime.ts` introduce an explicit review of the fixed schema operation. It is separate from `designReview`, `taskReviews`, task acceptance and release approval. Ordinary work/release gates and `sharepointOffice` remain unchanged.

The proposal binds the current repository/record reference, committed schema and design, task hash and resources, implementation/configuration digests, writer identity, exact operator approval and three fresh hash-checked control receipts. Only the assigned active independent QA session can persist a decision through `delivery_record` action `schema_bootstrap`:

```json
{"repo_id":"<connected repo>","action":"schema_bootstrap","payload_json":"{\"action\":\"inspect\"}"}
```

The review payload uses `action: review`, exact `proposalSha256`, `decision: approved|rejected` and specific `notes` of at least 80 characters. Approval expires within one hour and no later than its earliest control receipt. Changed source/task/plan/code/configuration/evidence requires another independent decision.

Authenticated office routes expose proposal inspection, assigned QA review admission, and fixed execution:

- `GET /api/repos/:repo/schema-bootstrap`
- `POST /api/repos/:repo/schema-bootstrap/review` with `{}`
- `POST /api/repos/:repo/schema-bootstrap/execute` with the exact `planSha256`

The execute route requires a current independent grant, separate full-plan operator approval, exact writer account/tenant/schema scope, dedicated target boundaries and unchanged authority before any lease or provider request. It runs the existing typed list-create executor. It cannot admit a generic coding worker or authorize content, folders, permissions, updates, deletion, flow/Canvas work or release.

## Target and recovery evidence

Authenticated read-only discovery confirmed Leon, the recorded default Power Platform environment and exact GraspAI SharePoint permission metadata. Current SharePoint and Teams connection identities match Leon; older errored connections are excluded. Approvals reports Connected but omits an effective accountName; no genuine approver response is inferred.

Native operation names/parameters and the schema-only recovery contract are documented in showcase commit `20318e37052fa5cfaaa24a6f972e945f55024183`. Task 5 now treats created IDs as readback outputs. Delivery record revision 38 changes only the pinned commit, task 5's inputs/stop conditions and a noncritical supporting finding. Other requirements and blockers are preserved. The commit is local and was not pushed.

Recovery is failure containment: shared lease and fsynced intent before dispatch, exact ownership/ID/schema readback before verification, and retained lease/history for unknown outcomes. There is no automatic retry, rollback, delete, name adoption or implemented unknown-outcome reconciliation. No live forced-crash rehearsal is claimed for schema creation.

## Tests and independent source QA

The targeted five-file suite passed **153 tests**, including 23 independent bootstrap cases. TypeScript checks passed. Tests cover unauthorized/expired/drifted grants, wrong caller/repository, missing operator authority/scope, linked evidence roots, configuration commitment, chronology and pre-dispatch guard revocation. Existing record, provisioning, HTTP and preflight gates remain covered. These are synthetic contract tests, not live write/recovery proof.

Independent source QA identified writer/config binding, cross-repository context and evidence-root linking gaps. All three were fixed and retested. The final source audit found no P1 findings and verified the restricted revision 38 changes.

DLP implementation and tenant policy changes are excluded. Full application architecture/task approval, normal delivery policy, runtime and release gates remain separate from this schema review.

## Authenticated outcome

The assigned application QA agent completed its review and persisted approval of proposal `f1e3f8d6401a6983ac06865e67c314bfc1f1358753e5200a8aedbca9210431a6` at 09:46:50 UTC, with inspect readback. It independently recomputed the implementation digest and checked the exact source, task, writer, operator scope, ownership and containment contract. This approved only the fixed schema stage; record 38, global designReview and taskReviews remained unchanged. The grant expired no later than 09:54:49 UTC and cannot authorize changed source/configuration/plan.

The authenticated fixed execution ran once. It created `AS-E2E CloudAsset Swarm Projects` (`2ff4739d-7ab4-48fb-a5de-c7766a6cd026`) but stopped on exact readback failure. The journal retained a dispatched intent and shared lease; no later resource was created. HTTP 500 was the office response; retained server diagnostics identify the schema readback mismatch. No automatic retry, deletion, adoption or journal reconciliation was performed.

Read-only diagnosis uniquely correlated the actual list to its exact `CubeFarm` ownership marker and unchanged journal. Native metadata omitted `TechnicalSummary.text.maxLength` and single-line `RunIdentifier.text.textType`. Missing multiline maxLength is not evidence of a 255-character limit.

The mapper now declares/checks only mode-appropriate facets: multiline requires plain text without a schema maxLength; single-line requires its explicit maximum without a textType claim. The type rejects legacy multiline maxLength declarations instead of silently normalizing them. A candidate plan removes only the two unsupported multiline caps (TechnicalSummary and StepDescription), producing hash `5abd1e7c88d94d9224c656ff37eb243a95b8f00e04c56312a58b760183d5ccfc`, locally committed as `aea24b9` without push. The original user requirement did not require those 255-character caps. This source correction is not a successful native rerun and has not been loaded into the paused office for further authoring.

Final focused validation passed **203 tests across eight files**, including 23 independent bootstrap and 10 native-text-facet cases; TypeScript checks passed. Independent QA found no new source issues. Missing/incorrect required facets still fail readback and retain intent, legacy multiline caps fail before dispatch, and a revised plan cannot automatically adopt old history. Final read-only retention verification confirms unchanged record 38/journal, zero release runs/sessions and paused office PID 17964. Recomputing the proposal after source correction differs from the saved grant: it no longer authorizes execution. See `output/schema-bootstrap-retention.json` and `output/schema-bootstrap-final-targeted-tests.log`.

**Next delivery blocker:** implement explicit evidence-bound reconciliation of the retained owned list/intent/lease, binding original plan/payload/marker/resource ID and the revised plan semantics, with native operation quiescence proof and fresh independent/operator approvals. A changed plan or renewed grant must not automatically adopt the list, release its lease or replay creation. Only then can the other resources and downstream app/flow stages proceed. Full application deployment remains unverified.

Live evidence:

- Review: `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/schema-bootstrap-app-qa/20261018T094212951385Z/verification.json`
- Execution: `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/schema-bootstrap-live/20261018T094738352508Z/verification.json`
- Read-only provider diagnosis: `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/schema-bootstrap-readback/1792316957293/evidence.json`
- Candidate plan details: `C:/temp/cubefarm/output/schema-native-text-candidate.json`
