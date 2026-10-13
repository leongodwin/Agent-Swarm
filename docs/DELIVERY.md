# Deliver a working Power Platform solution

A solution is complete when the intended user can open it in the approved development environment and its real workflows pass verification. Code, pull requests, local previews, generated manifests and solution imports are intermediate milestones.

For capability configuration, versioned starters, measurable UX gates, recovery receipts and monitoring, see [Reliability priorities 5–8](RELIABILITY.md).

## Team contract

The CEO assigns an implementation owner and an independent QA reviewer, using the existing team where possible. Plan the complete vertical slice first: user journey, data, permissions, UI, automation, deployment and verification. Avoid long dependency chains and repeated discovery. Read the relevant installed skill and confirm its actual MCP connection/CLI capability before starting. A missing tool, connection, permission, licence, environment setting or credential is a named blocker with an owner and remedy.

Use the supported authoring path for each component:

- Canvas Apps: author/compile with the Canvas Apps tools; check the generated app and publish/share it. Raw invented PA YAML is insufficient. Include the actual app in the solution.
- Model-driven apps: build the Dataverse model, security roles, forms, views, navigation and app module; publish and test with the intended user role.
- Code apps: build the real application and use the installed Power Apps deployment skill/CLI. Confirm the target in its configuration matches the runner's environment. Capture the playable app URL.
- Power Pages: use the site's creation/deployment skills, upload/publish/activate as required, configure authentication and table permissions, and test the actual website. Do not change environment settings or publish publicly without applicable authorization.
- Flows and copilots: use supported definitions/tools, bind real connection references/environment variables, activate/publish, run real inputs and check run history and outputs.

All deliverables belong to a named, versioned Power Platform solution. The manager authorizes the connected development environment in **Solution delivery**. The runner pins its URL; changing PAC profiles does not change that approval. Production and other environments require their own authorization. Demo never deploys.

## Architecture version and independent review

The architecture board supports separate requirements-template saves and model synthesis jobs. `POST /api/hld/jobs` accepts the validated requirements and connected `repoId`; no client filesystem path is accepted. The provider is the installed Codex CLI, using its existing account and native default model. Check `codex login status`; Microsoft/Dataverse authentication remains separate. Planning runs in an isolated temporary directory with inherited user configuration/rules disabled, a read-only sandbox and disabled shell/browser/apps features. Successful output must pass the strict structured schema and artifact readback. No Claude or GitHub Copilot CLI execution or fallback is permitted. Historical draft metadata is readable without enabling its old provider.

Synthesis uses JSON Schema draft-07 through the SDK's structured-output contract. Built-in filesystem, shell and browser tools, inherited MCP servers and project settings are disabled; supported permission paths deny tool authority. The server supplies selected installed Power Platform skill references and their hashes, with runtime tool access still unverified. It validates structured design sections, decisions, risks, requirement-to-acceptance mappings, diagrams and implementation steps, applies the local connector safeguard, and publishes a versioned unreviewed draft. This is a planning job, not platform authoring, deployment or effective tenant-governance approval.

The five-minute deadline covers admission, model execution, response validation and artifact publication. The board exposes status, duration, bounded event logs and observed usage. Completed model versions load explicitly; they do not replace newly edited requirements silently. Cancellation, timeout, scope/skill changes and shutdown deny late publication. Restarted in-progress jobs become blocked and require explicit inspection/restart, not automatic replay. Corrupted model-job storage is preserved; that capability becomes unavailable while other office views remain available. Maintenance pauses new model jobs, and Copilot Studio's existing pause remains in the planning context.

New release plans must include `architecture: { docId, sha256 }` from the saved structured architecture result. Commit both `docs/architecture/drafts/<docId>.json` and `<docId>.md` before creating the release. The server reads these files from the pinned default-branch commit, validates their content digest and repository ownership, and rechecks them before delivery and health monitoring. A current draft pointer or an uncommitted document cannot substitute for that version. Historical release state remains readable; missing architecture or review blocks execution.

The assigned independent QA session receives `review_architecture`. Inspect the pinned requirements, diagrams, implementation plan, permissions, tradeoffs, risks and missing evidence using `git show <release.head>:<path>`. Submit the exact release ID, plan hash, artifact hash, `approved` or `rejected` decision, and specific review notes. The server supplies reviewer identity from that session; the author cannot approve. Architecture approval is separate from `approve_release` and runtime evidence review. A rejected or changed architecture review revokes prior release approval. Once a run exists, the review is immutable: changes require a new release. The delivery panel exposes the version, decision, reviewer and notes.

A requirements template remains a draft even after an independent assessment. This gate establishes review of exact committed content; it does not establish actual model synthesis, comprehensive governance compliance, tenant deployment or runtime acceptance. Do not approve missing decisions merely to unblock the gate. Record gaps and reject the architecture until they are addressed.

## UX and design gate

Before building, record a short experience brief: audience, core tasks, navigation, brand, typography, color/spacing tokens and responsive behavior. Use a task-first layout for internal apps and a purposeful page narrative for public sites. Provide clear primary actions and useful loading, empty, error, validation and success states.

QA reviews the actual deployed experience at desktop and mobile widths (1440×900 and 390×844 are useful baselines). Check keyboard/focus behavior, labels, contrast, touch targets, responsive overflow, error recovery, readable content and visual hierarchy. Inspect screenshots rather than merely taking them. Use the Power Pages design critique/aesthetics/page-blueprint references for sites. Correct weak or generic design before passing the visual review. Capture a browser trace and accessibility results. A login screenshot or HTTP 200 is not a functional pass.

## Repository delivery manifest

### Target mapping and recoverable actions

Optional manifest fields `targetBinding`, `targetComponents` and `postDeployActions` enable the initial typed Dataverse adapter. Bind `organizationId` and `userId` to the approved target's `WhoAmI` result. Every CLI request explicitly uses the runner's environment URL. The adapter resolves components by logical name in that environment, requires membership in the named solution, and retains target IDs in `target-component-map.json` under the reviewed evidence hash. It rejects ambiguous matches. Canvas mappings retain both the Dataverse row ID and the target's `uniquecanvasappid`; source IDs must not be copied into target links.

For example, add these fields to an existing manifest:

```json
{
  "targetBinding": { "organizationId": "<target organization GUID>", "userId": "<approved caller GUID>" },
  "targetComponents": [{ "key": "approval", "kind": "workflow", "logicalName": "publisher_approval" }],
  "postDeployActions": [{ "id": "activate-approval", "type": "workflow-state", "component": "approval", "state": "active" }]
}
```

This action supports classic workflow definitions only; cloud flows and Copilot Studio flows require their own runtime adapters. The [Dataverse workflow reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/workflow?view=dataverse-latest) defines the category, type and state fields used here. Actions observe the desired state before writing and read it back afterwards. A lost response can be reconciled if that postcondition is observed; otherwise the run blocks. Changed target IDs or desired state invalidate a previous action journal. Legacy `postDeploy` executable commands retain conservative interruption handling. An interrupted import still requires investigation even if the requested solution version exists.

Deployments hold an exclusive local-machine lease for the entire target environment. All office instances must use the same `SWARM_LEASE_ROOT` (default `<SWARM_HOME>/resource-leases`) to coordinate. A dead deployment owner is not automatically replaced: verify that the CLI and platform operation have ended before clearing the exact lease file reported by the blocker. These leases do not coordinate separate computers or fence platform requests already in flight. Git worktree setup/removal also uses a repository lease; it preserves dirty desks and unpublished commits and reports branch ownership conflicts. This does not yet reserve Studio sessions or an agent's desk for its entire task lifetime.

The runner reads mappings again during verification and rejects changed target IDs. Canvas URLs in the project report must identify each mapped target app on `apps.powerapps.com`; a source-environment app ID or unrelated host cannot satisfy this check. Independent browser journeys remain required to establish that those apps work.

The Dataverse CLI adapter requires an existing approved authentication profile and JSON API output. Authentication failures or unexpected output block delivery; it does not initiate device-code authentication. Bounded schema, record-sharing, connection-repair and local Studio ownership adapters are implemented; their scope and limits are described below. Connection-reference verification maps each reference by logical name inside the named target solution, then requires a `connection-reference-check` action with its approved `connectionId` and `connectorId`. Missing, inactive or changed bindings block delivery. Checks run before flow activation and again during verification; a changed binding invalidates its earlier verified journal entry. The runner also compares every runtime flow connection to these approved references. Unmapped connector dependencies block activation. Binding checks do not establish connector authentication or successful flow execution; correlated runtime checks remain required.

### API-only acceptance

For a backend-only manifest (`hasUi: false`), use explicit `acceptanceProfile: "functional-development"`, `verification.identities: []`, `verification.scenarios: []` and `verification.api`. Keep `verification.baseUrl` as the approved environment URL. `verification.api.binding` must exactly match the manifest's organization/user binding. Its `checks` array requires at least four entries, covers journey/authorization/persistence/error-handling categories and every acceptance criterion, and contains QA-owned relative Dataverse GET resources plus scalar JSON-pointer assertions. Each entry has `name`, `criterion`, `category`, `resource`, and `assertions: [{ pointer: ["field", "nestedField"], equals: "expected scalar" }]`. The office executes these assertions independently of repository code, repeatedly verifies the caller/organization and retains result summaries without full response bodies. Cancellation and failed assertions block delivery.

API-only acceptance cannot contain Canvas/Copilot components, frames or browser scenarios, and cannot claim production acceptance. It does not launch a browser, demand storage-state files or fabricate app URLs/screenshots. Project transaction tests and correlated cloud-flow checks remain required where applicable; GET assertions do not independently prove a submission/approval transaction. QA uses `approve_backend` to review the exact evidence hash and recovery receipt without visual scores. UI releases retain the full browser/UX contract. The report for a backend release may have `appUrls: []` and no `ui` field.

### Deployment adapter scope

- `connection-reference-bind`: mapped reference, approved `connectorId`, desired `connectionId` and `expectedConnectionId` (nullable). Uses the observed Dataverse ETag in `If-Match`; refuses a different connector, inactive reference, changed source binding or absent ETag. A matching final `connection-reference-check` remains mandatory. Repair runs before final binding checks/flow activation. Lost responses are reconciled by observation rather than repeated writes. This changes an existing reference only; it creates no credentials/connections and grants no permissions.
- `dataverse-table` components resolve their metadata GUID, entity set and primary ID from the target, then require named-solution membership. `schema-check` actions declare columns with logical `name`, `type` and `required` level. Before import, the runner refuses incompatible changes to existing declared columns; missing tables/columns may be introduced through the supported solution import. After import, the declared contract must exist exactly. Optional `structure.relationships` and `structure.keys` pin approved relationships, cascade behavior and alternate-key columns. Existing structures must match before import; missing additive structures are allowed only before import. Post-import checks require every declared structure, and existing alternate keys must have an `Active` index. Metadata pagination, ambiguous identities and failed/pending indexes deny the check. These declarations do not certify undeclared columns/structures, source-package schema completeness, effective security or data conversion/restoration.

A `schema-check` can include this structure contract. Use reviewed application requirements and actual metadata identifiers; these illustrative values are not a policy recommendation:

```json
"structure": {
  "relationships": [{
    "kind": "one-to-many",
    "schemaName": "exp_Report_Line",
    "referencedEntity": "exp_report",
    "referencedAttribute": "exp_reportid",
    "referencingEntity": "exp_line",
    "referencingAttribute": "exp_report",
    "cascade": {"Delete": "Restrict", "Assign": "NoCascade"}
  }],
  "keys": [{"schemaName": "exp_Report_Key", "attributes": ["exp_code"]}]
}
```

Many-to-many declarations use `kind: "many-to-many"`, `schemaName`, `entity1`, `entity2` and `intersectEntity`. One-to-many declarations always require an explicit delete-cascade expectation and may also pin Assign, Share, Unshare, Reparent, Merge, Archive and RollupView. Keys compare column sets and active status; this verifier never creates or reactivates an index. [Microsoft describes the key index states](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/entitykeyindexstatus?view=dataverse-latest) and [cascade behaviors](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/cascadetype?view=dataverse-latest).
- `record-share`: mapped table, one `recordId`, one `principalId`, `principalType: "systemuser" | "team"`, `expectedRights: []`, and explicit rights limited to Read/Write/Append/AppendTo. It checks target/principal existence, rejects disabled users or unexpected direct shares, then uses `GrantAccess` and verifies the direct share. It does not grant security roles, modify/revoke existing shares or certify inherited/role-based effective access. Obtain the user's approval for the exact principal, record, rights and environment before enabling a grant. Never treat independent QA approval as a substitute for required human security approval.
- Canvas authoring ownership: workers use `canvas_authoring_acquire`/`canvas_authoring_release`; the HTTP equivalents are `POST /api/authoring/canvas/:app/lease` with `{owner}` and `POST /api/authoring/canvas/lease/release` with the opaque `{token}`. The connected environment is discovered live. Add affected target app GUIDs to `canvasAuthoringApps` in the delivery manifest so authoring and deployment contend for the same local resource. Save and close the actual Studio session before releasing. Tokens can release their persisted local lease after an office restart; live or interrupted ownership is never silently displaced. This coordinates participating local sessions; Microsoft Studio's remote editing lock still requires a supported session close, not a forced unlock or guessed table field.

`POST /api/delivery/platforms` with `{copilotPaused:true}` persists the user's pause across office restarts. Paused Copilot components cannot deploy; known Copilot/PVA-titled worker assignments and restored sessions are stopped/skipped. This does not disable GitHub Copilot as a coding runtime. The office's runtime diagnostics expose loaded adapter feature names, PID/start time and demo state at `GET /api/runtime` behind the existing local session authentication.

Example manifest fragment using actual discovered values:

```json
{
  "targetComponents": [{ "key": "dataverse", "kind": "connection-reference", "logicalName": "exp_sharedcommondataserviceforapps_274a0" }],
  "postDeployActions": [{ "id": "check-dataverse", "type": "connection-reference-check", "component": "dataverse", "connectionId": "shared-commondataser-874da412", "connectorId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps" }]
}
```

These IDs belong to the MyDevNet validation deployment. Discover and approve the target's own IDs for another environment; do not copy them as defaults. The fields follow [Microsoft's connection-reference contract](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/connectionreference).

### Shared authentication, cloud flows and Copilot Studio

Add `platformIdentity` to a manifest to consolidate readiness across providers without copying their credential caches:

```json
"platformIdentity": {
  "tenantId": "<approved tenant GUID>",
  "username": "leon@graspai.co.uk",
  "environmentId": "<approved environment ID, including Default- when applicable>"
}
```

Together with `targetBinding`, the runner checks live PAC organization/caller/environment, the Dataverse profile and `WhoAmI`, and FlowAgent's effective Azure/token/Connectivity identities when flows are included. It retains a credential-free `platform-authentication.json` receipt. Cloud-flow and Copilot components require this identity contract. Capability checks can reuse it through a `platform-auth` probe with `environmentUrl`, `binding`, `identity` and optional `includeFlow: true`. The app defaults to interactive PAC sign-in. Device code is an explicit API opt-in (`authMethod: "device-code"`); Conditional Access failures recommend interactive sign-in and policy diagnosis. Existing credentials remain with the provider that owns them.

Cloud-flow components use `kind: "cloud-flow"` and the Dataverse workflow unique name, or the packaged workflow GUID when that unique name is absent. A `cloud-flow-state` post-deployment action chooses `active` or `draft`, with `forceManaged` false by default. The adapter discovers and connects to the installed FlowAgent MCP runtime, checks actual tool availability, pins the environment on every request, resolves solution membership, runs preflight before activation and reads the runtime state back. Preflight validates a cloned definition after removing only the recognized server-injected connector `@parameters('$authentication')` reference; it preserves HTTP/custom authentication and does not change the deployed definition. Set `SWARM_FLOWAGENT_ENTRY` only when the installed runtime cannot be discovered. Managed overrides belong to the immutable reviewed manifest; the runner never adds one automatically. Already satisfied state is skipped, and an unknown mutation is reconciled only when its postcondition is observed.

Each cloud-flow component needs a QA-owned `verification.cloudFlowChecks` entry in the release plan:

```json
"cloudFlowChecks": [{
  "component": "approval",
  "action": "AuditResult",
  "correlationPointer": ["body", "releaseId"],
  "assertions": [{ "pointer": ["body", "saved"], "equals": true }]
}]
```

Project verification commands receive `SWARM_DELIVERY_RUN_ID`. Exercise synthetic inputs carrying this value, and make the named audit action record it in its actual output. The runner independently reads successful run history and recorded action content, requires this exact correlation plus output assertions, then retains `cloud-flow-verification.json`. A recent unrelated success cannot pass. Missing, expired or suppressed action content blocks verification. The initial adapter checks the latest 20 runs and supports scalar output assertions. Intentionally disabled flows still need a compatible runtime verification design; a disabled state alone does not prove functionality. Tests must not enable normal production notifications as a substitute for scoped synthetic verification.

Copilot Studio components use `kind: "copilot"` with the agent's schema name and require a `copilot-publish` action. The runner maps the target agent through Dataverse solution membership, invokes the supported PAC publish command with an explicit target and agent ID, and reads a fresh `publishedon` record with active/provisioned state. An old publication or provisioning-only status cannot pass. Publication can take time: if its fresh postcondition has not appeared, reconcile the blocked run after the platform finishes. Publication evidence is followed by live conversation tests; metadata does not certify conversational correctness.

The `copilot-studio` starter is available to workers, CEO tools and the delivery panel. It directs agents to discover local PAC capabilities and reuse installed Dataverse/Power Automate skills for tools, dependencies and packaging. Its tenant validation status remains false. Use [Microsoft's PAC Copilot reference](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/copilot) for workspace authoring and packaging; use an existing approved publisher/prefix rather than inventing one. Include the actual agent, topics, knowledge, flows and connection references in the combined solution.

Copilot release plans require `verification.copilotChecks` with `component`, `channelUrl` matching `verification.baseUrl`, and six distinct `cases` referencing existing browser scenario names. The required case kinds are `grounding`, `fallback`, `tool-action`, `authorization`, `safety` and `multi-turn`. Every case sends a test message and asserts an observed result; multi-turn sends and asserts at least two messages. Authorization uses an authorization scenario. Exercise the actual published channel, not the Studio authoring/test pane. The existing independent browser runner performs these cases and captures its normal screenshots/traces; `copilot-verification.json` binds the cases, target mapping and independent evidence. QA still reviews grounded answers, actual tool effects, denied access and refusal/fallback behavior. Single-account administrator testing retains functional-development limitations.

This batch does not include a tenant-validated Copilot starter, a native conversation SDK adapter, sovereign-cloud customization, automatic connection repair or tenant-policy changes. The existing browser verification and supported platform runtimes are the implemented paths.

Commit `cubefarm.delivery.json` at the root. The runner uses a detached worktree of the **remote default branch commit**, so unmerged or local modifications are never a release source. Every command is an executable plus an argument array; commands do not pass through a shell. For shell workflows, invoke a checked-in Node/PowerShell script explicitly. Avoid embedding credentials in arguments or files.

```json
{
  "schemaVersion": 1,
  "solutionUniqueName": "YourSolution",
  "solutionVersion": "1.0.0.1",
  "solutionZip": "artifacts/YourSolution.zip",
  "settingsFile": "deployment/development.settings.json",
  "hasUi": true,
  "recovery": {"runbook": "docs/operations.md", "rehearsalReport": "artifacts/recovery-rehearsal.json"},
  "documentation": ["README.md", "docs/architecture.md", "docs/user-guide.md", "docs/operations.md"],
  "build": [{"executable": "node", "args": ["scripts/build-solution.mjs"]}],
  "test": [{"executable": "node", "args": ["scripts/test-solution.mjs"]}],
  "postDeploy": [{"executable": "node", "args": ["scripts/publish-and-share.mjs"]}],
  "verify": [{"executable": "node", "args": ["scripts/verify-live.mjs"]}]
}
```

These script names are an example contract, not provided implementations or passing fixtures. The agents must implement them for the actual solution and have QA review the scripts and their assertions. Build/test commands must exit nonzero on failure. Commands receive:

| Variable | Meaning |
| --- | --- |
| `SWARM_DELIVERY_ENVIRONMENT` | Pinned HTTPS Dataverse environment URL |
| `SWARM_DELIVERY_COMMIT` | Exact source commit being delivered |
| `SWARM_DELIVERY_EVIDENCE` | Fresh run-specific directory for test results/screenshots/traces |
| `SWARM_DELIVERY_REPORT` | Fresh verification JSON output path |

The runner checks documentation, runs build and tests, checks PAC access, imports the ZIP with `pac solution import --environment <pinned URL> --publish-changes`, runs any required post-deployment publication/sharing/activation, then independently lists the environment's solutions and matches the unique name and version. Live verification follows. Connection settings must refer to actual existing connections; unresolved placeholders block delivery. The operations guide must cover prerequisites, ownership, connection setup, sharing, support, updates and rollback/recovery.

The scheduler runs explicitly scoped, independently approved releases. Only required GitHub issues must be closed; unrelated backlog and PRs do not block delivery. QA must confirm the required implementation is present in the pinned commit. Failed runs require explicit **Run / resume**. Completed runs are idempotent.

## Release planning and independent approval

The CEO uses `create_release(repo_id, plan_json)`, or the manager pastes the plan into **Solution delivery → Create a scoped release**. Creation pins the remote default-branch commit, approved environment and immutable plan hash. Changes require a new release and fresh approval. Duplicate plans for the same commit and target return the existing release.

The plan has these required fields:

```typescript
{
  name: string;
  owner: string;                 // actual developer agent ID from company_status
  qaOwner: string;               // different QA agent ID on the same project
  requiredIssues: number[];      // nonempty explicit release scope
  components: string[];          // all components that must be packaged
  acceptanceCriteria: string[];
  quality: { maxTaskDurationMs: number; maxSeriousAccessibilityIssues: 0 };
  monitoring: { intervalMinutes: number; criticalProbeIds: string[] };
  verification: {
    baseUrl: string;             // actual HTTPS application URL
    identities: { id: string; expectedUser: string; userSelector: string }[];
    scenarios: {
      name: string;
      identity: string;          // an identity ID above
      category: 'journey' | 'authorization' | 'persistence' | 'error-handling';
      states: ('loading' | 'empty' | 'validation' | 'failure' | 'recovery' | 'success')[]; // exactly one per scenario
      criterion: number;        // zero-based acceptance criterion index
      steps: (
        { action: 'goto'; path: string } | // same-origin absolute path
        { action: 'click'; selector: string } |
        { action: 'fill'; selector: string; value: string } |
        { action: 'text'; selector: string; contains: string } |
        { action: 'reload' } |
        { action: 'press'; selector: string; key: 'Tab' | 'Enter' | 'Space' | 'Escape' | 'ArrowDown' | 'ArrowUp' }
      )[];
    }[];
  };
}
```

Every criterion needs a scenario. The schema requires all four categories, two distinct identities, observable assertions, and a reload for persistence. Use actual selectors and expected outcomes. QA must reject superficial assertions, missing packaged components, tests without real writes, or authorization tests without denied access. Structural validation alone cannot establish test quality. Test data and cleanup must be safe to repeat at both viewport sizes.

The CEO calls `review_release` or the manager selects **Request assigned QA review**. This starts the assigned QA agent when it and a session slot are free. QA inspects the exact pinned commit and plan, then calls its session-bound `approve_release(release_id, plan_hash)`. The CEO and author have no approval tool. Rejected reviews are not automatically repeated. Correcting source or the plan requires a new release. A busy reviewer can be requested again when available.

Connect two real test identities with appropriate roles before deploying. Capture Playwright browser storage state through each identity's interactive sign-in and save it privately as `<SWARM_HOME>/delivery-identities/<id>.json`. Never commit these files. The runner validates their structure before import and checks the signed-in identity in the browser afterwards. Expired authentication blocks verification. Identity setup is an operator prerequisite.

The office-controlled browser verifier executes the approved declarative actions at desktop and mobile widths, checks origin and identity, fails on browser errors, and captures screenshots and traces. A project-written passing report cannot substitute for this step. The current adapter supports same-origin DOM applications with CSS selectors; iframe, native canvas and API-only applications need an appropriate adapter before passing. The office runs axe accessibility and overflow checks, enforces task duration and UX-state coverage, and then requires an independent visual/recovery evidence review before completion. Screenshots alone do not prove accessibility or visual quality.

## Persistence and recovery

Release plans, approvals, blockers, run journals and deployment checkpoints persist in `delivery.json`. A process lease prevents two offices sharing the state directory from deploying concurrently. Blockers name an owner and remedy, appear in the delivery panel, and trigger a CEO review when their content changes. Delivery revisions participate in heartbeat change detection.

On restart, unfinished runs are persisted as blocked. **Run / resume** reuses the run and pinned source. A confirmed import is not repeated when verification fails. Interrupted imports remain ambiguous even if the matching version exists: inventory alone does not prove that operation completed. The runner reads inventory and blocks pending inspection of tenant import history. Interrupted post-deployment scripts also block instead of repeating unknown side effects. After investigating and repairing tenant state, prepare an appropriately versioned replacement release with fresh QA approval. There is no automatic rollback of tenant data; destructive upgrades require explicit authorization.

## Live verification report

The QA-reviewed verifier must write this shape using **observed results**, not predetermined passing values:

```typescript
{
  environmentUrl: string;       // exact pinned environment
  sourceCommit: string;         // SWARM_DELIVERY_COMMIT
  solutionUniqueName: string;
  solutionVersion: string;
  verifiedAt: string;           // current ISO timestamp
  authenticatedUser: string;    // observed signed-in test identity
  appUrls: string[];            // real HTTPS playable app/site links
  tests: {
    name: string;
    category: 'journey' | 'authorization' | 'persistence' | 'error-handling';
    passed: true;
    evidence: string;           // nonempty file relative to evidence directory
  }[];                         // all four categories required
  security: 'passed';
  persistence: 'passed';
  ui?: {                       // required when hasUi=true
    desktop: string;            // screenshot evidence path
    mobile: string;
    trace: string;              // browser trace path
    accessibility: 'passed';
    designReview: 'passed';
  };
}
```

Test a primary task end to end with realistic test records, reload to prove persistence, verify access boundaries with the appropriate roles, and exercise validation/failure recovery. Clean up only the records created by the test. Check connector/flow outcomes in the actual environment. Authentication expiry, unavailable browser access and inaccessible tenant components are failures, not skipped passes. Keep private data and tokens out of screenshots/traces; never save or publish browser storage state as evidence.

The runner validates report freshness, commit, solution/version, environment, all required test categories and evidence files. Completion additionally requires the office-controlled browser checks. It retains the run, source checkout, app URLs and evidence under the office state directory. Project verification and subjective design/accessibility claims remain reviewed evidence. Agents and scripts run under the same operating-system account: independent workflow checks are not a security sandbox against malicious code.

## Current boundaries

The real delivery runner supports versioned Dataverse solution packages. Platform-specific publication, Power Pages activation, code-app deployment, sharing and live browser assertions are project scripts built with the appropriate installed skills/tools. The runner does not invent these steps, provision missing credentials or bypass licensing. Copilot chat and flow-history demo panels remain clearly marked simulations and are not delivery evidence.

CLI reference: [Microsoft Power Platform solution commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution).
