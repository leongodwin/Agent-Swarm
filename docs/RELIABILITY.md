# Reliability priorities 5–8

## Architecture drafts and review boundaries

The HLD generator no longer inserts a fixed field-service/Copilot architecture or labels generated text approved. It preserves supplied component scope and deliverables, marks output as a deterministic unreviewed draft, lists missing entity/workflow/security/licensing/runtime evidence and builds a review-required implementation outline. Topology edges group declared scope; they do not assert integrations. Missing data and workflow contracts remain explicit. Mermaid labels cannot introduce new statements through quotes, control characters or backslashes.

The editor uses the selected project's recorded brief and declared tenant, with no Contoso/incident defaults. Users can declare components, inspect the outline and gaps, navigate tabs by keyboard and open it directly from the project console. Saving confirms a server-returned path and retains the returned draft for unchanged input. Long briefs collapse for readability. The 3D station/tour also identify this as draft work, rather than claiming deployed security, automatic synchronization or backlog integration.

The authenticated route resolves filesystem paths from connected repositories and rejects caller paths, unknown/unavailable checkouts and Demo project writes. An isolated non-demo HTTP/filesystem regression verifies actual persistence; the Demo browser regression verifies editing, keyboard navigation and write denial. Neither proves tenant deployment or model synthesis. Actual synthesis/architecture review, durable structured draft reload, measured full-HLD-and-plan latency and the legacy commercial pricing/ROI model remain open. No real project HLD was overwritten during validation. Evidence: `.swarm-reliability/architecture-draft-coverage-2026-10-13.txt`, `architecture-draft-coverage-exit-2026-10-13.txt`, `architecture-draft-e2e-2026-10-13.txt`, `architecture-draft-ui-2026-10-13.png`, and `architecture-draft-live-ui-2026-10-13.png`.

## Restored capability evidence

Capability startup validates saved plans with the same probe/schema rules as new configuration and validates result identities, timestamps, lifetimes, check IDs and status/check consistency. Reserved dictionary keys are rejected before parsing, avoiding silent prototype-key removal. State is bounded by file size and project/check limits. Only a genuinely missing file initializes empty state; malformed, oversized, contradictory or disappearing files fail closed and retain their original bytes. An uninitialized/failed service cannot configure probes or execute checks.

Restored observations remain historical: the operations API marks them blocked with a refresh requirement until this office process completes live probes. Expired or future-dated current-process observations also lose their ready presentation; cached checks cannot reuse them. Valid plans are restored without silently resetting configuration. These checks establish persisted-state integrity and honest readiness presentation, not complete tenant compliance or authentication persistence. Evidence: `.swarm-reliability/capability-state-coverage-2026-10-13.txt`, `capability-state-coverage-exit-2026-10-13.txt`, `capability-state-api-e2e-2026-10-13.txt`, and `capability-state-live-runtime-2026-10-13.json`.

## Tool-time prerequisite refresh

Worker and CEO session authorization now supports asynchronous capability refresh before supported tool dispatch. Workers check their launch runtime and directly linked projects; the CEO checks its host and captured project scope. Concurrent requests share one in-flight refresh, then recheck task ownership and worker configuration before granting authority. Supported SDK/CLI hooks check authorization around request-local governance, and office MCP handlers await it before calling their handler.

The production capability service retains its 60-second observation TTL. Cache/pending keys include project, configuration, environment, runtime and resolved workspace path. Mixed runtimes retain independent cache entries; configuration changes invalidate all entries for the project. Expired observations are removed, and the cache is bounded to 1,024 entries. This avoids repeated authentication/MCP probes on every tool while preventing reuse from a different workspace.

Per-task abort signals wake admission/refresh waiters on cancellation, replacement or deletion; office shutdown also aborts them. Refreshes expire at the existing 90-second boundary, cannot grant from late replies and can recover after a transient blocker without starting a duplicate session. Provider operations already issued may continue; aborting the waiter does not prove native process termination. These are configured prerequisite checks, not complete model-account licensing, tenant schema/DLP certification or persistent authentication. No Copilot Studio work was resumed. Evidence: `.swarm-reliability/tool-readiness-coverage-2026-10-13.txt`, `tool-readiness-coverage-exit-2026-10-13.txt`, `tool-readiness-api-e2e-2026-10-13.txt`, and `tool-readiness-live-runtime-2026-10-13.json`.

## CEO callback ownership

Every CEO dispatch receives a task generation in addition to its job identity. Stopping the CEO invalidates that generation, clears the active session/tool pointers and cancels the active job immediately. Late logs, tool/checkpoint updates, phone replies, usage limits and completion from that generation cannot change a replacement job. Completion is processed once, including when a backend completes synchronously before returning its handle. Failed-launch callbacks also remain invalid if the same queued job object is retried.

Completion checks the captured job/generation before clearing state or adding costs/turns. Startup failures defer only the owning job. Worker and CEO stops now stamp their end time when cancellation occurs. Tests inspect real coordinator state and persisted checkpoints with synthetic session backends; physical stop acknowledgement, native restart recovery and costs of already-issued cancelled work remain separate verification requirements. Evidence: `.swarm-reliability/ceo-generation-coverage-2026-10-13.txt`, `ceo-generation-coverage-exit-2026-10-13.txt`, `ceo-generation-api-e2e-2026-10-13.txt`, and `ceo-generation-live-runtime-2026-10-13.json`.

## Session tool authority

Supported SDK pre-tool/permission callbacks and native CLI pre-tool hooks now require session authorization before request-local governance and recheck it after asynchronous policy/audit work. Missing, malformed or throwing authorization denies execution. Worker authority is bound to the active task generation, its launch configuration and completion state; legitimate runtime checkpoint updates preserve that binding. CEO authority is bound to its active job and working state. Cancellation, replacement, completion and shutdown revoke subsequent grants.

Worker/QA/CEO office-tool definitions apply the same authorization at handler dispatch for both SDK and per-request HTTP MCP servers, including direct tool-call helpers. A revoked reviewer cannot approve a release, and a revoked developer cannot initiate a Canvas lease. Idle CLIs deny pre-tool requests until a follow-up is admitted. Read-only tools also require an active task; manager-facing office APIs remain separate.

Tests exercise SDK callbacks, actual CLI hook routing with a synthetic PTY backend, MCP handlers in linked transports, and real coordinator options. They do not execute or authenticate a native model CLI. Authorization denials occur around the existing request-local audit, whose counters remain observed checkpoints rather than a complete authorization ledger. Already-dispatched handlers or external requests cannot be revoked by these checks. Untrusted/unhooked native tools, physical process containment, complete CEO callback ownership, temporal revalidation and full effective tenant schema/DLP enforcement remain open. Evidence: `.swarm-reliability/session-authority-coverage-2026-10-13.txt`, `session-authority-coverage-exit-2026-10-13.txt`, `session-authority-api-e2e-2026-10-13.txt`, and `session-authority-live-runtime-2026-10-13.json`.

## Worker execution context

Capability admission is bound to the worker task generation and its execution configuration: runtime/defaults, CLI checkpoint, model/effort, actor instructions, primary/linked project identities and requirements, target tenancy, browser mode and platform pause. The office also binds the scoped capability configuration digest and delivery policy. Probe observations and unrelated projects do not change this configuration digest.

Every linked reference repository receives capability checks with the same selected runtime. Changes during readiness deny admission; missing/changed configuration during workspace preparation or before launch denies execution and allows a fresh checked retry. QA and repair records leave their in-progress state when launch admission fails. Live follow-ups verify their scope again before sending; continuation and release-review callers report a denied launch instead of reporting success.

These tests exercise the actual coordinator with synthetic capability/session providers. They do not establish native CLI authentication, persistent sign-in, physical cancellation, fresh effective tenant policy/schema evaluation, or revocation of authority from an already-running process. Changes made outside the office and full pre-tool broker containment require separate live checks and enforcement. Evidence: `.swarm-reliability/admission-context-coverage-2026-10-13.txt`, `admission-context-coverage-exit-2026-10-13.txt`, `admission-context-api-e2e-2026-10-13.txt`, and `admission-context-live-runtime-2026-10-13.json`.

## Office startup and shutdown

Shutdown handlers are installed before retained-session recovery and capability admission. Quit/restart closes the swarm, tenancy, delivery scheduler, policy reader, capability checks and delivery admission barriers immediately. Cleanup runs concurrently and settles every service; a failing or stalled provider cannot prevent the others from starting cleanup. Repeated requests share one completion and preserve the first restart/quit decision.

Corrupted office-state startup and listener errors use the same cleanup path. Failed startup, failed cleanup and the 15-second forced-exit deadline return status 1 instead of reporting successful termination. A clean quit/restart returns 0. This does not guarantee completion after the deadline, handle hard process kills, or preserve policy authentication across reloads.

Regression tests cover stalled/throwing/reentrant cleanup and real isolated demo child processes with corrupted state, an occupied port and launcher-requested quit. They preserve corrupted state and verify exit codes. The non-demo office responded after its development reload at PID 71116, started `2026-10-13T04:37:45.444Z`; its earlier policy observation remained stale with no live reader. Native authenticated recovery remains unverified. Evidence: `.swarm-reliability/office-shutdown-coverage-2026-10-13.txt`, `office-shutdown-coverage-exit-2026-10-13.txt` and `office-shutdown-api-e2e-2026-10-13.txt`.

## Worker task ownership and cancellation

Worker tasks carry an in-memory generation that changes when a task is reserved or stopped. Capability checks, workspace preparation, QA metadata reads, PR lookups and session callbacks verify that generation before applying their results. Old callbacks cannot change a replacement task's session ID, tool/screen state, usage pacing, cost or QA handoff. Completion is processed once per session.

Stopping a worker invalidates its callbacks immediately, updates interrupted QA/repair state and schedules owned workspace cleanup directly. Worktree preparation and cleanup serialize per agent; a replacement waits for an earlier operation to finish and rechecks ownership before proceeding. Follow-ups and release reviews also wait for pending cleanup. Cancelled QA uploads do not initiate further evidence uploads or post an obsolete approval after reassignment.

Actual Swarm regressions exercise delayed failed readiness, in-flight preparation, obsolete callbacks, late PR discovery and cancelled QA evidence uploads. These prove coordinator ownership and ordering with a synthetic backend. They do not revoke native tool authority, cancel already-issued external requests, confirm physical process termination or provide complete containment. Full execution and policy/schema enforcement remain required. Evidence: `.swarm-reliability/task-generation-coverage-2026-10-13.txt`, `task-generation-coverage-exit-2026-10-13.txt` and `task-generation-api-e2e-2026-10-13.txt`.

## Retained CLI admission

Busy keeper sessions no longer bypass capability readiness on startup. The office verifies the returned agent/CLI/session metadata and terminal support, checks the actual retained CLI, and rechecks pause/cancellation before following it. Keeper metadata replaces stale persisted runtime ownership. A verified retained terminal is adopted as that CLI even when the office default has changed to SDK, avoiding a second SDK session alongside the surviving process.

Admission checks run concurrently before reopening waiting hooks. Blocked, paused, malformed or expired sessions invoke their owned terminal's release/quarantine path; no replacement model session starts. Interrupted QA records return to the queue without approval, and interrupted repairs leave the fixing state. Shutdown prevents hook reopening or late adoption. The shared readiness boundary now expires worker/CEO decisions after 90 seconds, responds to shutdown and ignores late results.

Tests exercise actual Swarm startup with a synthetic keeper/session backend and real terminal-emulator persistence. They verify metadata selection, ordering, pause changes, timeout, quarantine invocation and pipeline state recovery. They do not establish physical process termination, native keeper recovery, worktree identity, authenticated CLI accounts or complete containment of unhooked/idle native commands. Full native execution and policy/schema certification remain required. Evidence: `.swarm-reliability/retained-admission-coverage-2026-10-13.txt`, `retained-admission-coverage-exit-2026-10-13.txt`, and `retained-admission-api-e2e-2026-10-13.txt`.

## CEO dispatch admission

The CEO reserves a preparing slot before readiness checks. Non-demo dispatch requires native terminal support, a configured CEO readiness provider and a usable ready decision. The office provider checks GitHub authentication and the fixed Copilot CLI, then checks the job's project scope (including declared linked projects). Additional reference directories are limited to that checked scope. Project paths, targets, links or requirements changing during verification invalidate admission.

Readiness expires after 90 seconds. Blocked, unavailable, expired, workspace-failed or session-start-failed jobs return to the durable queue with a reason and a 60-second retry cooldown. Identical blockers do not repeatedly notify the manager; fresh operator/capability information permits an immediate retry. CEO state exposes `blockedReason` and `retryAt`, and an office phone notice carries the remediation. A cancelled preparing job is removed immediately; late results cannot dispatch it over a replacement. Shutdown retains an unfinished preparing job for restart recovery.

The tests exercise the actual Swarm with synthetic readiness and session backends, including real terminal-emulator persistence. They do not verify a native Copilot process, its authenticated account/licence, retained-process reconnect or actual office-tool negotiation. CLI response plus GitHub authentication is prerequisite evidence, not full Copilot authentication or tenant governance. Full policy/schema admission and native execution certification remain open. Evidence: `.swarm-reliability/ceo-admission-coverage-2026-10-13.txt`, `ceo-admission-coverage-exit-2026-10-13.txt` and `ceo-admission-api-e2e-2026-10-13.txt`.

## Repair checkpoint ownership

QA records persist the developer session ID and its owning CLI together. Handoff, requeue and repair completion update the pair as one state change; an agent's newer unrelated session cannot change the runtime owner of an earlier repair checkpoint. Repair preparation copies the selected checkpoint into the active task before readiness checks, so blocked dispatch retains the intended checkpoint.

A checkpoint resumes only for its original developer and a compatible runtime. SDK repairs can resume Claude checkpoints; terminal repairs use the recorded CLI. Unknown legacy CLI provenance, incompatible SDK checkpoints and developer takeovers start a fresh session with the current PR and QA instructions. Unknown agent-level CLI provenance is also no longer inferred as Claude. This may create a fresh session for legacy offices, while preserving the repository work and avoiding an incorrectly routed resume.

Actual Swarm regressions exercise handoff, a newer unrelated agent session, blocked readiness, migration, compatible repair dispatch and checkpoint replacement on completion. The terminal-path test includes real emulator persistence with a synthetic backend, not a native CLI process. Native reconnect/retention, live CEO admission and authoritative full policy/schema enforcement remain separate requirements. Evidence: `.swarm-reliability/repair-checkpoint-coverage-2026-10-13.txt`, `repair-checkpoint-coverage-exit-2026-10-13.txt` and `repair-checkpoint-api-e2e-2026-10-13.txt`.

## Follow-up and release-review readiness

Non-demo Swarm instances deny readiness when no capability provider is configured or its reply is empty/unknown. The server adapter requires a nonempty ready result with every check passing; a blocked result with no failed-check remedies still returns a blocker. Providers are installed before Swarm initialization and restart recovery.

Worker follow-up prompts to active sessions and resumed worker sessions now check readiness. Resume checks use the effective runtime: the saved session's CLI for terminal continuation, or Node for SDK execution (including terminal configurations where native terminals are unavailable). New continuations reserve their agent before awaiting checks, retain their saved checkpoint when blocked, and cannot start after cancellation or shutdown. Workspace preparation also stops if the assignment was cancelled during readiness checks.

Release reviews reserve their assigned QA agent, run the same capability check, and revalidate the agent/session before dispatch. Failed readiness can be retried without resetting the reviewer; a live session or reserved reviewer still blocks concurrent review. Fix sessions preflight the runtime selected by their recorded repair checkpoint and dispatch context.

These changes cover capability admission, not comprehensive policy/schema approval. Retained CLI processes, directly typed native execution, live CEO dispatch, and full governance across all runtime paths remain unverified or incomplete. Existing authenticated policy inventory does not authorize these paths. Evidence: `.swarm-reliability/session-admission-coverage-2026-10-13.txt`, `session-admission-coverage-exit-2026-10-13.txt`, and `session-admission-api-e2e-2026-10-13.txt`.

## QA evidence and merge admission

QA reports use one bounded runtime schema for both the authoring output contract and server parsing. Empty summaries/checks, unknown outcomes, malformed entries and coerced values are rejected. A pass requires every reported check to pass; skipped or unverified required checks cannot support approval. Failed reports need actionable findings. Interrupted/failed sessions cannot approve, terminal parsing uses the final JSON report without falling back to an earlier pass, and screenshot captions must match captured images. A pass also requires the task's tested commit. These constraints validate reported evidence; they do not independently prove each claimed command ran or each acceptance criterion was covered.

Retesting revokes approval immediately. A legacy approval without a tested SHA cannot adopt the current head. Auto-merge and the manager's Merge action require the same commit-bound QA, GitHub checks/readiness and exact-head local-source scan. Manager merging refreshes the PR under the merge lock, pins the selected method and approved SHA, and blocks rather than dispatching fixes or updating branches. Unknown/blocked/unstable readiness waits. Changed heads cannot combine old cached checks/scans with new details. Approval revoked or shutdown begun during a scan prevents a later merge.

The client receives tested/passed commit IDs and presents stale or missing bindings for fresh QA. Kanban has no “Merge anyway” option; the HUD, floor/lobby counters and terminal chips count only current approvals and label them QA approved. This status is distinct from successful final merge verification. The rendered browser regression uses explicitly synthetic WebSocket fixtures; real Swarm scheduler and merge transitions use an isolated synthetic backend. No GitHub PR or tenant was mutated by these tests.

The source scanner remains a local heuristic. This batch does not certify full tenant DLP, comprehensive Dataverse schema enforcement or unrestricted runtime safety. Complete authoritative lifecycle governance remains a separate required gate. Evidence is `.swarm-reliability/qa-merge-coverage-2026-10-13.txt`, `qa-merge-api-ui-e2e-2026-10-13.txt` and `qa-merge-ui-2026-10-13.png`.

## Office restart and shutdown integrity

Office startup treats only a missing state file as a first run. Unreadable files, invalid JSON or critical persisted shapes, duplicate repository/agent IDs, oversized files and newer state versions stop startup with the state path and a preserve-and-repair instruction. The reader does not reset or rename the original evidence. Legacy settings migrations remain supported. A failed load cannot save defaults during cleanup.

Shutdown closes scheduler and preview admission immediately, cancels recurring and delayed scheduler timers and clears log/save timers. Preparation and readiness completions after closing cannot start new agent sessions. SDK session handles stop while their task/session checkpoints remain available for restart recovery; terminal CLI sessions remain with the keeper when restarting. Closing callbacks cannot change those checkpoints or schedule new saves. Preview PR checks completing after closure cannot start a process. Shutdown is idempotent; persistence errors remain reported while process cleanup still runs.

These are local lifecycle guarantees verified with actual Swarm instances, isolated persisted offices and a synthetic backend. They do not establish native terminal survival, process-crash recovery, all in-flight external-operation cancellation or tenant deployment recovery. Existing live tenant recovery evidence is separate. Tests and built-office API evidence are under `.swarm-reliability/swarm-lifecycle-*2026-10-13.txt`.

## Implementation update: skills, scoped acceptance and verification

Both Codex and office agents can discover installed Power Platform skills through `installed_skills` (optional task description), the authenticated `/api/installed-skills` endpoint, or the delivery panel. Discovery covers shared skill folders, nested mobile instructions and enabled Codex plugins. Configure additional shared roots with `SWARM_SKILL_ROOTS` and plugin cache roots with `SWARM_PLUGIN_ROOTS` (OS path delimiter). Plugin enablement comes from `CODEX_HOME/config.toml`, or the default `.codex` location.

The catalogue refreshes at dispatch and records SHA-256 content provenance. Task prompts select at most eight relevant references and prefer a versioned plugin over an equivalent shared alias. Cached plugins without confirmed configuration are explicitly marked `activation: unconfirmed`; explicitly disabled plugins are excluded. Multiple cached plugin versions are shown as a warning: the catalogue selects the newest numeric version, but the worker must verify its active version and actual tools. Installation is explicitly `toolStatus: unverified`; existing live capability probes remain separate. New releases pin relevant skill files/hashes in their QA-approved release hash and block if those instructions change before execution. Legacy approved plans retain their hashes.

Release plans may explicitly set `acceptanceProfile: "functional-development"` to exercise one licensed identity. Independent QA, mapped criteria, persistence/error/authorization journeys and UX/recovery gates still apply. This scope never certifies production readiness or employee/approver isolation. Omitting the field preserves the original strict two-identity contract. The runner retains a hash-bound `acceptance-scope.json` containing the target, commit, package, plan and identity declarations; a browser identity assertion does not establish installed privilege depth.

Functional-development project verification reports may explicitly use `security: "not-verified"` while retaining actual functional authorization-rule tests. Strict acceptance rejects that value. No report needs to manufacture a security pass to document development-only functionality.

Independent browser verification supports an optional `verification.frame: { selector, origin }`. The parent application and selected frame must stay on their separately pinned HTTPS origins. This is an initial frame adapter, not proof that every Canvas authoring/runtime control is supported or that the Expense tenant's previously pending upload has passed.

Receipt test steps use `{ action: "upload", selector: "<actual file input>", fixture: "receipt.txt", sha256: "<64 lower-case hex characters>" }`. Put synthetic files in the office's `delivery-fixtures` directory. Filenames/extensions are constrained; real-path containment, nonempty content, a 10 MiB size limit and the QA-approved byte hash are checked. The file is selected through the actual browser input and retained in evidence. Follow it with an observable upload-completion assertion; selection alone does not prove storage/retrieval.

The deployment runner journals import and individual post-deployment mutation intents before executing them. It retains command hashes and explicitly labelled import job IDs where PAC returns them. Lost responses are marked unknown and never blindly replayed. Typed platform reconciliation and shared editor/worktree leases remain work for the next milestone; the existing conservative ambiguous-checkpoint block remains in force.

## 5. Capability checks before work

Before preparing developer, PR QA or fixer worktrees, the office checks readiness. It reserves the agent while checking, so another scheduler pass cannot assign it twice. Failures leave an actionable agent error and persisted project readiness record. Equivalent checks share one in-flight request and cache for 60 seconds. A new worker CLI, environment or configuration invalidates that cache. GitHub authentication and the selected worker CLI are checked even for projects without Power Platform requirements. Demo performs no live probes.

For Power Platform projects, configure probes in **Solution delivery → Capabilities and implementation starters → Configure project probes**. The same API is `POST /api/repos/:repo/capabilities/configure`. The project must cover authentication, environment, licence, MCP, CLI and connector categories. A deployment also requires its named critical workflow probes. Unknown or missing access is blocked; installed skills or a connected PAC profile are not licence evidence.

Configuration shape:

```typescript
{
  environmentUrl: string; // exact project/deployment target
  checks: {
    id: string;          // unique stable identifier
    category: 'authentication' | 'environment' | 'licence' | 'mcp' | 'cli' | 'connector' | 'workflow';
    remedy: string;      // precise owner/action to restore readiness
    probe:
      | { kind: 'cli'; executable: 'git' | 'gh' | 'pac' | 'node' | 'dotnet' | 'codex' | 'claude' | 'opencode' | 'copilot'; minimumVersion: string }
      | { kind: 'mcp'; url: string; tools: string[]; tokenEnv?: string }
      | { kind: 'mcp'; command: string; args: string[]; tools: string[] }
      | { kind: 'http'; url: string; tokenEnv?: string; pointer: string[]; equals: string | number | boolean;
          freshness?: { pointer: string[]; maxAgeSeconds: number } };
  }[];
}
```

HTTP probes issue GET requests with redirects disabled. Use a real authoritative API or an authenticated local readiness provider. `pointer` walks an observed JSON response, including array indexes as strings. For example, a licence probe must check the required SKU/service-plan identity **and** its active provisioning status for the intended user; add multiple checks when necessary. Environment probes must establish the caller's access to the named target, and connector probes must check the actual required connection IDs/status. A generic HTTP 200 or an administrator's different identity is insufficient.

For Microsoft Graph, commercial Dataverse and Power Platform API HTTPS endpoints, HTTP probes can use `azureCli: { tenantId, username }` instead of `tokenEnv`. The office verifies the current Azure CLI account, refreshes the resource token, and checks the returned token's tenant and user before sending it. Tokens remain in memory and are never persisted in readiness results. Azure credentials cannot be forwarded to arbitrary hosts or redirects. Concurrent checks share token acquisition requests. This reuses the operator's existing sign-in; it does not grant additional consent or permissions.

Use `matches` instead of `equals` to match a subset of an observed JSON object or unordered array. For example, set `pointer: ["value"]` and `matches: [{ skuId: "<actual SKU GUID>", servicePlans: [{ servicePlanName: "POWERAPPS_PER_USER", provisioningStatus: "Success" }] }]`. SKU and provisioning status must belong to the same observed licence. Empty object/array expectations do not pass.

Connectors can instead use `{ kind: "pac-connection", environmentUrl, api: "shared_office365", account: "maker@example.com", connectionId: "<actual connection ID>" }`. The environment must match the project and PAC must report the exact API/connection as Connected. `account` checks PAC's account display name. Connectors such as Approvals expose a generic display name; omit `account` only when pinning an exact connection ID whose ownership was verified during configuration. Neither an account nor an ID may be omitted together. A connection being Connected is prerequisite evidence; actual operations and application-user authorization still require release tests.

Use credential environment-variable names, never raw tokens. These variables must be available to the office process. For expiring credentials, prefer a local provider that uses the supported authentication SDK to refresh tokens. Missing credentials, expired authentication, failed MCP negotiation, missing tool names, unknown licence responses and unsupported CLI versions fail readiness. Configure MCP endpoints with the same credentials and tool set intended for workers; a separate unrelated MCP server is not evidence of worker capability.

Workflow probes additionally require `freshness`: check the latest successful critical workflow observation's timestamp, not the HTTP response time. Use a maximum age appropriate to its business schedule. The runner does not manufacture workflow runs or invoke mutation scenarios while monitoring. Sparse workflows can use an explicitly designed read-only synthetic health endpoint.

The CEO's `capability_status` tool shows failures and remedies. **Refresh readiness** forces a new check. Successful configuration does not mean the probes passed. Readiness is a workflow gate, not an operating-system sandbox or a guarantee against credentials expiring during a task.

## 6. Versioned implementation starters

The office ships five starter bundles: Canvas Apps, Power Pages, Dataverse, Power Automate flows and deployment. Use the CEO's `implementation_templates` tool or **Add starter reference bundle** in the delivery panel. Every install creates a new `swarm-starter-<platform>-*` directory without overwriting source. `template-lock.json` records version and SHA-256 hashes.

Bundles contain supported authoring recipes, required discovery steps, experience/recovery documents, shared design tokens, a verification checklist and a real PAC packaging script. That script refuses missing exported source or failed/empty packaging. On Windows, set `SWARM_PAC_EXECUTABLE` to the native PAC executable if the installed command is only a shell shim.

Canvas authoring starts with the installed Canvas Authoring skill and actual `sync_canvas`/schema/compile tools. Power Pages uses its curated template catalogue. Flows use `list_templates`/`scaffold_flow`, operation discovery and validation. Dataverse uses the installed SDK/tools and discovered publisher. The catalogue deliberately does not invent platform schemas or pass off local fixtures as working tenant components.

The bundles are **locally tested workflow and packaging scaffolds**, not yet tenant-proven reference applications. Their `tenantVerified: false` status remains explicit. A reusable reference application can be promoted only after its real release is deployed, independently verified and its evidence retained. Project-specific business logic, component authoring and connection setup still have to be implemented.

## 7. Measurable UX gates

Release plans require `quality: { maxTaskDurationMs, maxSeriousAccessibilityIssues: 0 }`. Each scenario names exactly one UX state, and the plan must cover loading, empty, validation, failure, recovery and success. At least one task uses a keyboard `press` action. Every scenario has an observable assertion and maps to an acceptance criterion.

At desktop and mobile widths, the office measures scenario duration, checks for horizontal overflow and browser errors, and runs pinned axe WCAG 2 A/AA and WCAG 2.1 AA checks. Serious and critical violations block release. Accessibility JSON, screenshots and traces are retained, including failure diagnostics. An automated axe pass is not comprehensive accessibility certification: keyboard behavior, screen-reader meaning and visual quality still need review.

Passing automation moves the run to **reviewing**, not complete. The assigned independent QA agent inspects every captured screen, task outcome, UX state and recovery receipt. Request that review through `review_release` or the panel. QA then calls `approve_visual` with the run's evidence hash, specific review notes, `recovery_reviewed: true`, and five scores from 1–5 in this order:

1. Hierarchy and clear primary action.
2. Readability, contrast and meaningful labels.
3. Consistent spacing, typography and components.
4. Responsive layout and touch usability.
5. Task clarity, feedback and error recovery.

Every score must be at least 4. Author/self-approval and changed evidence are refused. The evidence directory is returned in delivery status for the reviewer. Any revisions require rerunning verification and reviewing the new evidence hash. A project-written `designReview: passed` cannot bypass this gate. The current browser adapter supports same-origin DOM applications; Canvas, iframe and API-only adapters remain separate work.

## 8. Recovery and continuing health

The delivery manifest now requires:

```json
"recovery": {
  "runbook": "docs/operations.md",
  "rehearsalReport": "artifacts/recovery-rehearsal.json"
}
```

Before import, the runner retains the tenant's existing solution inventory and links the previous verified run when present. It hashes the package and retains the recovery runbook, rehearsal receipt and supporting evidence. A retry refuses a modified package.

The rehearsal receipt must describe an **actually performed restoration test** in a separately authorized test environment, within the last 30 days:

```typescript
{
  sourceCommit: string;          // exact release commit
  performedAt: string;           // ISO timestamp
  environmentUrl: string;        // separate rehearsal environment
  procedureSha256: string;       // SHA-256 of the exact runbook bytes
  restored: true;
  dataPreserved: true;
  protectedRecords: { table: string; id: string; beforeSha256: string; afterSha256: string }[];
  evidence: string[];            // nonempty files relative to the checkout
}
```

Hash the canonical protected record fields, ownership, relationship references and attachment bytes before and after restoration. Every declared record's hashes must match; duplicate record identities are rejected. QA must confirm the protected-record set covers the solution's critical data and inspect the observed receipts. Produce or retrieve the report during the build against the pinned commit; do not commit a report that tries to contain its own commit hash. The office validates and requires independent review of rehearsal evidence; it does not execute a tenant restore or independently certify that a submitted receipt is truthful. A separate rehearsal environment is **not** authorized by selecting the development deployment target.

No automatic reinstall or destructive rollback is performed. The runbook must choose a data-preserving restoration or forward repair, identify dependencies and connections, and describe post-recovery verification. Missing, stale or mismatched evidence blocks import.

Release plans also require `monitoring: { intervalMinutes, criticalProbeIds }`, with 5–1440 minutes and at least one configured `workflow` probe. After completion, the app checks the installed solution/version, capability configuration fingerprint, live connections and fresh workflow observations. It never replays the release's write tests as a health check. Version/configuration drift or failed probes mark health **degraded** and notify the CEO on change; unchanged failures do not repeatedly notify. Successful recovery clears the health incident. Checks persist their next due time and resume after app restart. **Check health now** runs the same checks manually. Pausing delivery pauses automatic checks; monitoring requires the office server to be running.

A historical completed release remains in the audit trail even if current health degrades. The panel shows current health separately, so a past verified deployment is not presented as a guarantee of current availability.

PAC can print `Error:` to stdout while returning exit code zero. The command runner treats that as a failure and retains the uncertain import checkpoint. An import/uninstall lock must be investigated before retrying; exit code zero alone is not deployment evidence.
