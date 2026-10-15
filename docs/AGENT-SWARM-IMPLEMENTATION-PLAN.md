# Agent Swarm implementation plan

Prepared 10 October 2026; reconciled 15 October 2026. Current scope and remaining work are recorded below.

## Current roadmap — 15 October 2026

The P0 brief-to-deployed-backend path is implemented and independently demonstrated for one reference-only functional-development slice. See [current status](PRODUCTION-GOAL-STATUS.md) and the [pilot completion report](BACKEND-PILOT-COMPLETION.md). This is branch-level evidence, not a published-package or default-branch release claim.

Completed for this pilot: shared delivery record; evidence-backed discovery; grounded model design and independent review; pinned package/manifest and target; existing-licence manual governance; runner-owned data/recovery transactions; native import; independent backend QA; shared slice receipt; evidence-retention and restart corrections. API-only verification and actual synthesis are no longer wholly outstanding. They have bounded implementation and pilot evidence, not universal platform proof.

| Priority | Next outcome | Completion evidence |
| --- | --- | --- |
| P1 | Operational handover and health | Preserve the accepted archive and package; run scheduled registered probes and retain their actual result. Keep current health separate from release acceptance. |
| P1 | Full Expense application slice | Reconcile the complete scoped package and component ownership; connected Canvas source/compile/App checker, actual receipt UI, approval/notification flow and intended-user positive/negative permission journeys pass independent QA at the current source/package. |
| P1 | Production acceptance contract | Name the target, audience, required controls and owners; verify actual licence assignments/configuration, least privilege, applicable policy/schema enforcement, broader recovery and operating procedures. Development manual approval cannot authorize production. |
| P2 | Platform and tenant breadth | Independently author, package, deploy and verify each advertised starter/platform and required tenant configuration. Copilot delivery work stays paused until explicitly resumed. |
| P2 | Measured reliability and efficiency | Refresh cross-platform CI and whole-backend coverage; meet the unchanged 90.01% gate and assess the 99.5% reliability and under-five-minute synthesis goals over declared representative windows. Preserve failures in the denominator. |

Backend acceptance excludes UI, employee isolation, least privilege, tenant-wide automated governance and solution-wide rollback. No remaining milestone should be closed using the backend receipt alone. Existing tables/service behavior and an administrator maker were prerequisites, not delivered least-privilege infrastructure.

## Historical implementation plan — prepared 10 October 2026

The original batches, proposed module locations and milestones below are retained as design history. Their present-tense “pending”, test counts, environment observations and uncommitted-work notes describe those dated batches, not today's working tree. Use the current roadmap above for prioritization and the delivery contract for executable requirements. In particular, the original full Expense M3 and Copilot M4 milestones are not satisfied by the narrower backend pilot.

Implementation has begun. The first batch adds dynamic installed-skill discovery and worker/CEO tools, relevant prompt selection, skill content locks in new releases, explicit functional-development acceptance, runner-owned scoped evidence, an initial approved-frame/file-input verifier and mutation journaling. Existing baseline tests passed before edits. These additions require local regression validation and subsequent tenant validation; they do not complete all phases below. Authentication consolidation, typed target/platform reconciliation, shared-resource leases, API-only verification, dedicated Copilot lifecycle delivery, individual starter tenant proof and full recovery rehearsal remain outstanding.

Local validation completed for the first batch: the baseline had 393 passing tests; the subsequent full-suite run had 406 passing tests and one pre-existing todo. A final delivery-focused run passed all 28 tests after adding the explicit unverified-security regression. Four authenticated API/delivery-panel browser tests passed, and the final type check/build passed. Frame/upload tests exercised real browser fixtures, not the deployed Expense application. Discovery currently finds 232 skill references, including eight Dataverse instructions whose worker activation is explicitly unconfirmed. Existing working-tree changes were preserved; no tenant deployment or main-branch submission was performed by this batch.

## Outcome

Third batch implemented: shared authentication readiness across PAC, Dataverse and FlowAgent; interactive sign-in by default with explicit device-code opt-in and Conditional Access guidance; a reusable capability probe and credential-free delivery receipt. Cloud-flow delivery now uses the installed FlowAgent runtime, explicit target identity, solution mapping, preflight, typed state reconciliation and independently read release-correlated run outputs. Copilot Studio has a starter, target mapping, typed PAC publication and required independent published-channel conversation cases. Legacy Dataverse GUID validation was corrected after a live read exposed sequential IDs that are not RFC-versioned UUIDs. The new shared authentication path passed a read-only MyDevNet check for Leon on 10 October 2026. This check does not constitute a flow deployment, a published Copilot conversation test or starter tenant validation.

Third-batch validation: the full suite passed 430 tests across 46 files, with one existing todo. After the final Copilot runner/link regression was added, all 31 delivery tests passed. Four authenticated API/delivery-panel browser tests and the final TypeScript/client/server build passed. The existing Vite large-chunk warning remains. Adapter tests cover identity mismatch, sequential Dataverse GUIDs, lost cloud-flow/Copilot publication responses, observed drift, unrelated successful runs, required conversation coverage and full runner evidence binding. Live validation was read-only authentication/tool discovery against MyDevNet; no tenant mutation, flow invocation or Copilot publication was performed in this batch. Tenant proof for the new adapters and Copilot starter, native conversation SDK verification, API-only acceptance and the remaining migration/sharing/Studio-lock adapters are still outstanding.

Second batch implemented: local-machine resource leases coordinate Git worktree setup/removal and serialize deployments to each target environment. Worktree reuse/removal preserves dirty files and unpublished commits; branch collisions identify the owning checkout. Typed target binding checks the organization and caller, maps Canvas/workflow logical names to target solution members, and retains those IDs in reviewed evidence. A classic-workflow state adapter observes postconditions and safely reconciles lost responses. Opaque command/import interruptions still block; cloud-flow, sharing, connection-reference, schema migration and Studio ownership adapters remain pending. Deployment leases left by a dead owner require checking for in-flight platform operations before manual clearance. This batch has no tenant deployment or tenant validation claim.

Second-batch local validation: 420 tests passed across 44 files, with one existing todo. Four authenticated API/delivery-panel browser tests passed. The final TypeScript check, client build and server bundle succeeded; the existing large Vite chunk warning remains. Regression coverage includes branch ownership, preserving dirty files/unpublished commits, concurrent lease acquisition, dead-owner recovery policy, changed lease tokens, wrong target/caller, solution membership, ambiguous mapping, stale Canvas links, unknown action outcomes, observed drift, unsupported cloud-flow activation and runner-level lost-response recovery without duplicate import/activation.

Agent Swarm should take a solution brief through design, implementation, documentation, packaging, deployment and independent verification in the selected Power Platform tenancy. It should deliver the installed application or Copilot Studio agent, usable links, evidence and operating guidance. It should resume safely after interruption and give a precise next action when human input or tenant administration is necessary.

Both Codex and the agents running inside Agent Swarm have access to many installed Power Platform skills. These are a principal development resource: discover and reuse them before creating bespoke authoring code. Installed instructions, available runtime tools, authenticated access and tenant authorization must each be verified separately. This session exposed the difference between them repeatedly.

## Baseline and session lessons

The current working tree already contains capability checks, immutable release plans, deployment checkpoints, implementation starter bundles, independent browser verification, visual review and continuing health checks. Preserve and extend this work. There are substantial existing uncommitted changes: inventory, review and validate them before making a coherent baseline commit; do not reset or discard them.

Concrete gaps observed in the code and this session:

- `server/deliveryCapabilities.ts` exposes a hard-coded list of 11 skills from two directories. The machine also has versioned plugin skills, including Dataverse and many authoring, deployment, security and diagnostic workflows.
- `server/independentVerification.ts` supports same-origin browser DOM journeys. Canvas hosted frames, receipt upload and platform API verification need explicit supported adapters.
- `server/releasePlan.ts` requires two distinct identities. A single administrator can exercise functionality but cannot prove employee/approver isolation. Release scope must represent this honestly.
- Deployment checkpoints already exist. Restart after import or post-deployment side effects currently requires investigation; operation IDs and action-specific reconciliation would enable more safe automated recovery.
- Existing starters are scaffolds with explicit `tenantVerified: false`; each needs its own tenant proof. Copilot Studio delivery is not a first-class starter/adapter in the inspected catalogue.
- Authentication failed because the tenant blocked device code flow. Interactive authentication succeeded subsequently. A blocked authentication method needs a supported alternative, not repeated retries.
- Import encountered an existing relationship-name mismatch. Target metadata reconciliation was necessary to preserve data and dependencies.
- Import produced a new Canvas app ID, and installed role privileges differed from their intended definition. Read back target IDs and privileges before links, notifications or acceptance are finalized.
- Receipt storage/retrieval and approval journeys had evidence, but an API upload did not establish Canvas picker/upload success. Synthetic notifications did not establish unrestricted production notification readiness. Evidence needs explicit scope.
- Git branch/worktree ownership collisions and Studio editing locks need coordinated leases and observed cleanup.

Targets carried forward from this session: MyDevNet (`https://org0efd6060.crm4.dynamics.com`) is the selected deployment destination; Development (`https://org68dad46d.crm4.dynamics.com`) was separately authorized for validation/recovery. Verify organization and tenant IDs on every run. Neither designation authorizes production deployment elsewhere.

## Architecture and delivery records

Extend the existing Node/TypeScript delivery runner using small modules rather than replacing it. Proposed modules below are implementation locations, not existing files.

| Area | Proposed location | Responsibility |
| --- | --- | --- |
| Skill catalogue | `server/skills/` | Discover installed skills, resolve versions and select task-specific workflows |
| Runtime capabilities | `server/capabilities/` | Match skills to actual tools, authenticated identity and environment readiness |
| Platform adapters | `server/platforms/` | Discover, author, validate, package, deploy, reconcile and verify each platform |
| Operations and leases | `server/operations/` | Durable side-effect journal, ownership, reconciliation and safe resumption |
| Acceptance evidence | `server/verification/` | Platform-specific tests, evidence scope and independent review |
| Reference implementations | Existing `server/implementationTemplates.ts` plus versioned assets | Proven reusable examples and shared UX foundations |
| Operator experience | Existing delivery panel and API | Progress, blockers, human tasks, artifacts and current health |

Define versioned records with migrations for existing persisted state:

- **Solution brief:** users, outcomes, platforms, data, integrations, UX requirements, environment and acceptance criteria.
- **Task contract:** inputs, dependencies, owner, selected skills/versions, expected artifacts, acceptance tests, resource leases and retry policy.
- **Environment binding:** tenant, organization, environment URL/ID, authenticated caller, connection references and verified access timestamp. No credentials.
- **Operation record:** release/package identity, action, intent, platform correlation/job ID, status, expected postcondition, reconciliation observations and attempts.
- **Component map:** source logical identity to resolved target component ID, installed version, links and dependencies.
- **Evidence record:** criterion, method, actual identity/privilege context, environment, commit/package hashes, component version, timestamp, artifacts and result.
- **Human task:** exact required action, reason, owner, affected run, completion probe and resume point.

Use explicit states such as planned, ready, running, awaiting-human, reconciling, blocked, verified and completed. A process exit, successful package or agent narrative must not directly mark a solution delivered.

## Phase 0 — Establish the baseline and acceptance contract

Owner: delivery lead; review: QA owner. Dependency: none.

1. Review the existing modified/untracked files and current delivery documentation. Identify which are locally passing, integrated and tenant-proven.
2. Run the relevant existing unit/integration tests and build. Create a baseline of actual failures before adding new behavior.
3. Inventory current delivery records, worktrees, running jobs, editing sessions, installed skills and configured worker runtimes.
4. Reconcile older documentation with the combined Expense deployment results. Keep outstanding receipt UI, least-privilege and recovery limitations explicit.
5. Define acceptance profiles:
   - **Functional development validation:** may use one licensed administrator; cannot certify role isolation or production readiness.
   - **Production acceptance:** requires applicable intended-user roles, independent QA, authorized deployment scope and complete required journeys.
6. Add schema migrations so existing releases retain their recorded scope. Do not silently relax their gates.

Exit: reviewed baseline, passing required checks or named existing failures, documented evidence gaps and agreed acceptance semantics.

## Phase 1 — Make installed skills a first-class capability

Owner: runtime/orchestration engineer. Dependency: Phase 0.

1. Replace the hard-coded prompt list with a skill registry. Discover configured shared skill roots and the active plugin/version manifests. Avoid indiscriminately selecting old versions from the plugin cache.
2. Register skill name, platform, task type, source/path, package version or content hash, required tools and related skills. Support aliases and duplicate resolution while retaining provenance.
3. Include Canvas, model-driven and code apps; Dataverse data/metadata/security/solutions; Power Automate; Power Pages; mobile/offline; UX/design and relevant integration skills.
4. Discover actual Copilot Studio authoring and lifecycle capabilities separately. The installed `add-mcscopilot` skill supports integration into code apps; it must not be mistaken for proof of a complete Copilot Studio authoring/deployment workflow. Record any gap precisely.
5. At task dispatch, match task intent to the smallest relevant skill set, read its instructions and verify its required tools in the actual worker session. Codex and app agents use the same catalogue and task policy.
6. Pin selected skill/tool versions in task and release records. Invalidate cached discovery when plugin versions, runtime configuration, credentials, target or relevant skill content change.
7. Prefer the skill's supported workflow to handwritten XML/YAML, guessed APIs or duplicate utility scripts. If a skill requires a Studio action or human confirmation, create a resumable human task with a completion probe.
8. Show separate statuses for installed skill, available tool, authenticated connection and authorized tenant operation.

Tests: plugin-only skills, duplicate aliases, stale versions, absent MCP tools, cache invalidation and fresh worker-session discovery. Exit: representative tasks on every supported platform receive the correct skills and proven runtime capabilities without loading the entire catalogue into prompts.

## Phase 2 — Centralize authentication and environment readiness

Owner: platform integration engineer. Dependency: Phase 1; can overlap Phase 3 after contracts stabilize.

1. Extend current readiness checks into a shared environment service. Verify tenant, organization, actual caller, required license/service availability and operation-specific privileges before dispatch and before mutations.
2. Support tenant-approved interactive/SDK authentication. Detect policy blocks such as device-code denial and create one actionable sign-in task; do not recommend weakening Conditional Access or silently switch accounts.
3. Refresh credentials through supported providers. Keep tokens in memory or the provider's secure cache; redact credentials and signed URLs from logs/evidence.
4. Resolve exact connection references and owners. A Connected status establishes readiness; a real required operation establishes functionality.
5. Classify failures: transient throttling/network/service locks; human sign-in/consent; license/access; incompatible metadata; permanent configuration. Retry only the appropriate class with bounded backoff and platform retry hints.
6. Add worker-session probes, not only server-process probes, so missing hooks/MCP capabilities are detected before an agent starts implementation.

Tests: expired credentials during a task, wrong tenant/profile, blocked flow, missing license, disconnected connection and HTTP 429. Exit: dispatch is gated by the correct caller/target, and access failures produce a single precise remedy with a resume point.

## Phase 3 — Durable recovery and shared-resource ownership

Owner: orchestration engineer. Dependency: Phase 0 contracts.

1. Extend existing checkpoints with intent-before-action operation records and persisted platform job/correlation IDs. Store observed postconditions separately from command output.
2. Add leases for branch/worktree ownership, Studio authoring sessions and environment/solution deployment. Include owner, expiry, heartbeat and fencing generation; a stale worker must not continue mutations after ownership transfers.
3. When a Git branch already belongs to a worktree, inspect ownership and repository state. Reuse a suitable owned checkout or create a distinct branch; preserve uncommitted work and never force-remove another agent's worktree.
4. On restart, reconcile each incomplete action through platform state/history. Resume confirmed unfinished work; accept confirmed completion; block contradictory or unknowable outcomes.
5. Split post-deployment commands into typed actions with independent reconciliation: publish, activate flow, bind connection, share app and configure environment variables. Never replay a whole command list blindly.
6. For external messages, persist business event/deduplication keys and dispatch outcomes. Reconcile unknown sends where the provider supports it; otherwise require investigation. Do not promise exactly-once delivery where the platform cannot guarantee it.
7. Close owned Studio sessions and confirm editing lock release before export. Preserve saved work and guide the user if a live human-owned session is the blocker.

Tests: restart before/after import submission, lost success response, competing schedulers, lease expiry, locked Studio and ambiguous notification dispatch. Exit: interruption tests retain work and evidence without duplicate imports, conflicting writes or blindly repeated messages.

## Phase 4 — Platform adapters and target reconciliation

Owner: platform specialists; integration owned by delivery lead. Dependency: Phases 1–3 interfaces.

Implement a common adapter contract: discover, plan, author, validate, export/package, deploy, reconcile and verify. An unsupported operation is an explicit capability gap, not a simulated success.

1. **Dataverse:** inspect existing schema, relationships, date behavior, dependencies and security roles. Generate compatible migrations; compare installed privileges with the approved definition. Block unexpected elevation and apply reductions only within the established policy.
2. **Canvas:** supported authoring, live data-source schemas, compile/app checks, save/publish and real `.msapp` packaging. Verify saved bindings and lock release; resolve imported app IDs from the destination.
3. **Power Automate:** discover connector operations, validate/preflight definitions, bind target connections, package solution-aware flows, activate and inspect actual run history.
4. **Power Pages:** supported site/template workflow, target website binding, authentication/table permissions, activation and deployed desktop/mobile journeys.
5. **Model-driven/code apps:** reuse their installed authoring/deployment skills; retain applicable build, packaging and runtime proof.
6. Maintain a target component map after import. Derive deep links, flow references, notification URLs and documentation from it. Refuse source-environment IDs in target-facing artifacts.
7. Choose managed/unmanaged packaging according to the destination's agreed lifecycle. Record dependencies and upgrade strategy; do not globally change solution type.

Tests: relationship-name conflict, missing dependency, app ID change, date behavior mismatch, disconnected connection, unexpected role privilege and missing packaged asset. Exit: a complete installed package is reconciled against the approved target contract with data-preserving changes.

## Phase 5 — Independent platform verification and usable UX

Owner: QA engineer, separate from implementation owner. Dependency: adapter contracts; implement Canvas/API verification early alongside Phase 4.

1. Add verification adapters for same-origin web, hosted Canvas frames, Dataverse/API, flow execution and Copilot conversations. Use supported interfaces and explicit origin/frame boundaries rather than weakening the existing browser restriction.
2. Add supported receipt/file selection, upload completion, authenticated retrieval and byte/hash comparison. Use synthetic fixtures and run-specific record IDs.
3. Map every acceptance criterion to an observable test. Label API, UI, manual and conversation evidence separately. API success cannot satisfy a required UI journey.
4. Make functional development and production acceptance distinct in the schema and UI. For Leon's single administrator account, show role-isolation coverage as unverified. A second least-privilege identity remains required where the production criteria call for it.
5. Exercise submission rules, approval/rejection, duplicate actions, notifications, persistence, denied access and recoverable errors. Verify recipient inbox/channel delivery where required, not just sender action success.
6. Retain the current UX gates and extend them to platform adapters: desktop/mobile, keyboard/focus, useful labels, loading/empty/validation/failure/recovery/success states, task timing, accessibility and independent visual review.
7. Bind evidence to exact environment, caller, commit, package and component version. Changes invalidate affected evidence and require the appropriate rerun.

Exit: the Expense reference demonstrates the actual Canvas receipt journey and repeat-safe approvals/notifications; its remaining identity constraints stay visible. Production acceptance is impossible if required authorization tests are absent.

## Phase 6 — First-class Copilot Studio delivery

Owner: Copilot specialist; review: independent QA. Dependency: Phases 1, 2, 4 and verification contract.

1. Discover supported tenant tools, licensing, publishing and channel capabilities. Resolve dedicated lifecycle skill/tool gaps before implementation.
2. Track agent instructions, topics, knowledge, actions/tools, agent flows, connection references and dependent solution components. Validate completeness before export/import.
3. Rebind destination configuration, publish and verify the intended channel. Imported components alone do not establish a usable published agent.
4. Create versioned conversation test sets: normal tasks, ambiguous requests, missing data, unauthorized actions, grounding, tool failure and recovery. Check action outcomes and data permissions in addition to answer wording.
5. Where available, use Microsoft's supported evaluation connector, capture run IDs, poll completion with limits and retain results. Check tenant availability and preview constraints before making an evaluation mechanism a mandatory gate.
6. Verify at least one real authenticated conversation in the intended delivery channel, with observable backend action/persistence and appropriate failure handling.

Exit: an installed, published, reachable agent with complete dependencies and evidence for conversations and backend operations.

## Phase 7 — Proven starters, documentation and continuing health

Owner: platform/design specialists and operations owner. Dependency: each corresponding adapter and tenant verification.

1. Promote each starter independently after actual tenant deployment and QA. Record template version, skill versions, package hash, environment, test coverage and known limitations. Add Copilot Studio once its workflow is proven.
2. Build shared design tokens and platform-appropriate components: spacing, typography, color/contrast, forms, lists, navigation, receipts, status and error recovery. Provide tailored designs rather than identical dashboards for every brief.
3. Generate documentation from deployed records: architecture/data model, identity/role model, user guide, configuration, installed components, known limitations and recovery/runbook. Include working links from the target component map.
4. Extend current health monitoring to adapter-specific observations: connection expiry, flow failures/backlog, version/configuration drift, application access and agent/channel availability. Do not run write journeys or send notifications as routine health probes.
5. Record incidents on state change with ownership and remediation; avoid repeated unchanged alerts. Re-verify affected acceptance journeys after repair.
6. Rehearse recovery of the complete reference solution in the separately authorized environment. Include configuration, application/flow versions, critical records and receipt bytes. A field repair or export alone is not proof of complete recovery.

Exit: independently proven starter versions, deployment-derived documentation and observed healthy/degraded/recovered monitoring plus complete recovery evidence.

## Phase 8 — Optimize task execution using measured results

Owner: orchestration engineer and delivery lead. Dependency: task/evidence records; tune after one complete vertical slice.

1. Make task dependencies explicit. Allow independent design, documentation and component work concurrently; serialize shared editors, overlapping schema writes and deployment to the same target.
2. Reuse validated schema/tool discovery keyed by tenant/environment/version/configuration. Never cache user permissions as permanent facts.
3. Send only relevant skill instructions, task inputs and changed evidence to agents. Retrieve detailed logs on demand instead of repeating entire histories.
4. Bound retries, agent loops and task/tool budgets. Escalate persistent blockers with observations rather than spawning duplicate investigation tasks.
5. Maintain separate implementation and QA ownership. Preserve established agent duties; add a specialist assignment only for an actual capability gap.
6. Measure time spent building, waiting for human/tenant actions, retrying, integrating and reviewing. Track cost per verified solution and use recurring failure classes to choose the next optimization.

Exit: a benchmark comparing the same reference tasks before and after changes, with no loss of acceptance coverage or evidence quality.

## Delivery sequence and reviewable milestones

| Milestone | Scope | Required demonstration |
| --- | --- | --- |
| M0 | Baseline and acceptance profiles | Existing work reviewed; state migrations and release scope agreed |
| M1 | Skills and readiness | Fresh worker selects installed skills and proves correct target/tool access |
| M2 | Operations, leases and recovery | Interrupted import/session resumes safely without conflicting ownership |
| M3 | Expense vertical slice | Full Canvas/API/flow package, target reconciliation, genuine receipt and notification evidence |
| M4 | Copilot vertical slice | Published agent, intended channel, conversation evaluations and actual action outcomes |
| M5 | Remaining platforms and starters | Each advertised starter independently tenant-verified |
| M6 | Operations and optimization | Complete recovery rehearsal, health incident/recovery and measured efficiency improvements |

Recommended first implementation batch: Phase 0 plus skill registry and acceptance/evidence contracts, then Canvas/API verification, target reconciliation and operation journaling as one Expense vertical slice. This addresses observed failures before expanding the advertised platform surface.

Do not assign calendar promises before baseline review and tenant capability discovery. Estimate individual backlog items after defining adapter boundaries; human licensing/sign-in and Microsoft service availability are external dependencies, not engineering completion dates.

## Acceptance measures

- Every advertised platform has a real author/package/deploy/verify path and an independently verified reference.
- Every delivered release has traceable criteria and scoped evidence; zero unsupported claims of UI, permission or production readiness.
- Restart/fault-injection scenarios create no duplicate side effects in tested cases and preserve uncommitted work and protected data.
- Target IDs, versions, dependencies, connections and installed privileges match the approved contract.
- Required UX states and desktop/mobile journeys pass existing timing/accessibility thresholds and independent visual review.
- Documentation and usable links match the actual installed version.
- Readiness and human blockers identify one owner, precise remedy and safe resume point.
- Efficiency improvements are supported by baseline/comparison measurements, not reduced testing or inflated completion rates.

## Handover for every completed solution

Provide deployed app/site/agent links, solution/component versions and package hash; acceptance matrix with actual evidence and limitations; user/admin documentation; operational probes and incident ownership; recovery instructions and rehearsal evidence. Keep historical release completion separate from current health.

## References

- Current repository: `docs/DELIVERY.md`, `docs/RELIABILITY.md`, `server/deliveryCapabilities.ts`, `server/releasePlan.ts`, `server/delivery.ts`, `server/independentVerification.ts` and `shared/delivery.ts`.
- Microsoft guidance supports automated build, tests, packaging and controlled deployment: [Power Platform continuous integration](https://learn.microsoft.com/en-us/power-platform/well-architected/operational-excellence/release-engineering-continuous-integration).
- Supported evaluation automation, subject to actual tenant availability: [Copilot Studio evaluation connectors](https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-agent-evaluation-automate-tools).
