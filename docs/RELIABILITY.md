# Reliability priorities 5–8

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
