# Remediation — 9 October 2026

All twelve findings and the enhancement recommendations below have been implemented in the working tree. The original review is retained as historical context; its line references and original verification counts describe the pre-fix code.

| Finding | Resolution |
| --- | --- |
| 1 — Shell injection | Native PAC executable resolution, argument arrays, runtime input validation, and credential-safe errors. |
| 2 — Terminal null crash | Validate message objects and finite numeric resize dimensions before dispatch. |
| 3 — Browser terminal access | Local Host/Origin checks and an HttpOnly session protect APIs and both WebSocket endpoints. CLI hooks retain separate tokens. |
| 4 — Device-code login | Stream instructions into pending jobs; completion requires successful process exit. Jobs support expiry and cancellation. |
| 5 — Demo external actions | Demo tenancy is fake and demo notifications never invoke real PAC or Teams webhooks. |
| 6 — Failed DLP bypass | A missing, failed, or incomplete scan blocks merging with a retryable explanation. |
| 7 — Partial-file DLP | Read full supported changed files at the pinned PR head, parse authentication structure, and verify the head again. API listing limits also block incomplete inspection. |
| 8 — HLD Save | Await an atomic server write to the connected checkout; propagate disk failures and reject paths escaping through symlinks. Demo saves are disabled. |
| 9 — Blocking discovery | Async PAC operations, coalesced discovery, cached results, and explicit stale/disconnected status. |
| 10 — Invented tenancy | Unknown fields stay unknown; an active PAC profile is required for an environment target. |
| 11 — Fictional architecture | Real scans start empty, validate artifacts, use relative-path IDs, detect PCF, and omit invented telemetry. Demo fixtures are labelled. |
| 12 — Branch update QA | Clear approval/head records and requeue QA after branch integration. |

Enhancements include centralized request schemas; queued atomic persistence; persisted repository/environment-scoped ALM, Teams, and flow history; genuine previous-state rollback; explicit simulation messages; empty/error states and guarded async loading; and deferred renderer/panels with low-graphics and reduced-motion settings. Failed feature-state writes restore the previous in-memory state. Fixer worktrees also use unique local branches while pushing the original PR branch, resolving the reported branch-already-in-use error.

The production build reduces initial JavaScript from approximately 1.99 MB to 303 KB (before compression). The 2.24 MB physics chunk remains deferred and is skipped in low graphics mode.

Verification: 36 test files, 348 passing tests and one existing todo; production build passed; packaged-install smoke passed in an isolated demo home. Chromium integration checks cover API validation, session and WebSocket rejection, persisted flow resubmission, demo login isolation, welcome-screen asset loading, keyboard/panel behavior, rendering, and movement. All nine Chromium integration tests passed, including simulation labels and clearing empty flow results.

Real credentials, GitHub writes, actual coding-agent execution, production deployment, and external Teams delivery were not exercised. Those boundaries use injected runners and fake HTTP responses in regression tests. Copilot/flow/ALM features remain simulations, and DLP remains a local heuristic. Tests used isolated state and reserved test ports; the live office was not touched.

---

# Code review — 9 October 2026

Reviewed the current working tree, including the existing edits in `server/tenancy.ts` and `client/src/ui/CopilotChatOverlay.tsx`. No application code was changed. This is a static review plus targeted reproductions and the repository's automated checks; it is not a guarantee that every runtime path is correct. Real agent sessions, production deployments, authentication, and external notifications were not exercised.

## Findings, in priority order

### 1. P1 — Tenancy login interpolates request values into a shell command

**Location:** `server/tenancy.ts:157–179`.

Profile name, environment URL, tenant ID, application ID, and secret are surrounded with quotes and concatenated into `exec()`. Embedded quotes break that quoting; shell expansion also changes legitimate secret values. With `exec` mocked, a profile name of `x" & echo REVIEW_MARKER & rem "` produced a command containing an independent `echo` command on Windows. No injected command was executed during the review.

Use an executable and argument array, resolving the Windows PAC shim to its executable entry point. Validate fields and redact credentials from failures. Reuse the CLI resolution approach already present in `server/clis.ts`.

### 2. P1 — Terminal WebSocket accepts null and crashes its message callback

**Location:** `server/terminal.ts:149–160`.

`JSON.parse('null')` succeeds, then `msg.t` throws outside the catch. A fake socket reproduction confirmed `Cannot read properties of null (reading 't')`. This uncaught EventEmitter callback exception can terminate the office process.

Require a non-null object before inspecting its fields, then validate each message variant. Add regression coverage for null, primitives, arrays, malformed JSON, and invalid resize values.

### 3. P1 — Arbitrary websites can attempt to connect to the live terminal

**Location:** `server/index.ts:301–307` and `server/terminal.ts:156–159`.

The upgrade handler checks only the URL path. It checks neither browser Origin nor an authenticated session. Binding to loopback prevents remote network access, but a website running in the user's browser can attempt a loopback WebSocket connection. Where browser network policy permits it, `/ws` exposes agent IDs and `/ws/term` accepts keystrokes into unsandboxed agent sessions.

Check Origin against the office's allowed origins and authenticate browser connections with a session token. Preserve separately scoped CLI hook tokens. Add an integration test that rejects an unexpected Origin before upgrading. Exploitability depends on browser local-network restrictions; the missing server-side protection is confirmed by inspection.

### 4. P1 — Device-code login supplies instructions after the login process is over

**Location:** `server/tenancy.ts:174–187`.

Device-code output is buffered by `exec` until its callback. The UI therefore cannot show the code while PAC waits for the user. At 30 seconds the process is killed; if its output contains the device-login URL, the code returns `ok: true` despite the failed command. The user receives a code from a terminated login and the UI reports success without authenticated credentials.

Stream the device-code instructions while keeping the authentication process alive. Represent pending, completed, failed, and expired states separately; report success only after PAC exits successfully.

### 5. P1 — Demo features can change real authentication and send real Teams messages

**Location:** `server/index.ts:160–223`, `server/almGate.ts:73–85`, and `server/tenancy.ts`.

The core swarm selects a fake backend in demo mode, but tenancy select/login and Teams webhook posting bypass it. A demo user can change the real PAC profile or create credentials. If `TEAMS_INCOMING_WEBHOOK_URL` is set, demo notifications and simulated ALM approval can post to the real channel.

Put these operations behind the real/demo backend boundary. Demo should use fake tenancy and a local notification feed, with no real CLI writes or webhook posts. This contradicts the README's promise that demo mode changes nothing.

### 6. P2 — DLP scan failure permits auto-merge

**Location:** `server/swarm.ts:1033–1042`.

If `prDiff` fails, the code logs a warning, leaves violations empty, and continues to the merge decision. A transient GitHub failure therefore bypasses the advertised DLP gate.

Track scan availability explicitly. Wait and retry when the diff cannot be inspected, showing an actionable merge note. Test that a rejected diff request cannot reach `backend.mergePull`.

### 7. P2 — DLP scanning misses unsafe changes when surrounding JSON is unchanged

**Location:** `shared/dlp.ts:54` and `shared/dlp.ts:108–138`.

The scanner examines only added diff lines, while the anonymous-authentication regex requires both the `authentication` key and the nested `type: None`. A PR changing only `type` from `ActiveDirectoryOAuth` to `None` keeps `authentication` in diff context. A targeted reproduction returned zero violations for this change.

Inspect the complete changed file at the PR head and parse connector/authentication structure. Keep text scanning as a documented heuristic rather than asserting full tenant DLP compliance.

### 8. P2 — HLD Save reports success without saving a file

**Location:** `client/src/ui/HldViewerModal.tsx:70–72`.

`handleSaveToRepo` only pushes a success toast. It never calls `api.generateHld`, and the client generator cannot write files. Users lose the document they believe was saved.

Call the server save operation, wait for completion, and display the returned path. The server currently silently catches write failures (`server/hldAgent.ts:16–18`), so those also need to propagate as errors.

### 9. P2 — Tenancy discovery blocks the entire office server

**Location:** `server/tenancy.ts:72–86,132`.

Uncached tenancy discovery runs consecutive synchronous Azure and PAC commands with five- and eight-second timeouts. During those calls, the event loop cannot serve HTTP, terminal output, hooks, or scheduling. Switching profiles can synchronously block another ten seconds. Several UI panels trigger tenancy discovery.

Use asynchronous process calls, coalesce concurrent discovery, and cache the last successful result while refreshing. Keep independent CLI requests concurrent where appropriate.

### 10. P2 — Missing tenancy data is replaced by a specific person's account and org

**Location:** `server/tenancy.ts:63–67,206–213`.

When CLI discovery fails, responses retain hardcoded GraspAI/Leon identity values. `getActiveEnvironment` also supplies a concrete Dynamics org URL when no profile exists. If Azure succeeds but PAC does not, `isReal` can be true while the environment remains invented. These values propagate into architecture and release views.

Return explicit disconnected/unknown values and require an active PAC profile for an environment target. Keep sample identities exclusively in demo fixtures. Azure account identity and PAC profile identity should not be assumed to belong to the same tenant.

### 11. P2 — Real architecture results contain fictional components and lose duplicate names

**Location:** `shared/solutionParser.ts:142,159,176,194`.

Real scans start from all fallback Contoso nodes, so discovering one real artifact still reports the fictional SAP, voice, Azure OpenAI, and other components alongside it. IDs based on filenames also overwrite topics/flows with matching basenames in different solution folders. Every YAML file is classified as a Copilot topic, regardless of its directory or content.

Start real scans with an empty component map, use relative paths or solution-scoped IDs, and validate supported artifact structure. Label fallback architecture separately and do not invent success-rate telemetry for discovered files. PCF detection described in the module header is not implemented.

### 12. P2 — Updating a PR branch treats new commits as already QA-approved

**Location:** `server/swarm.ts:1063–1069`.

After `updateBranch`, the newly fetched head is assigned directly to `passedSha`. QA tested the previous head, but subsequent merge decisions accept the new one. Base integration can change behavior, and a concurrent developer push before `prDetails` returns can also receive this automatic signoff.

Requeue QA for the new head instead of changing its approval SHA. Keep the merge's existing head-match guard. Test a concurrent push during branch update.

## Enhancement opportunities

- **Make simulation boundaries consistent.** Flow telemetry and the release modal already disclose simulation, which is helpful. Copilot chat still supplies scripted Dataverse, Teams, and safety claims beneath a live environment name. Clearly label it, and keep simulated release announcements out of real Teams. The flow resubmit endpoint should preserve simulated runs on refresh and reject unknown run IDs instead of silently selecting the first fixture.
- **Validate REST inputs centrally.** New proposal/HLD/tenancy routes mostly trust request shapes. Use runtime schemas, resolve HLD save locations from connected repository IDs rather than arbitrary client paths, and return useful 400/404 errors. The DLP route currently substitutes the first repository for unknown IDs, which can display results for the wrong floor.
- **Serialize persistence.** `writeState` and `AgentTerminal.save` use shared `.tmp` names without a write queue. Periodic saves can overlap shutdown saves or another slow write, causing rename failures or stale output. A serialized writer with pending/latest state avoids this race. This is an inspection-based concurrency risk, not reproduced during this review.
- **Expand integration coverage.** Current tests give good coverage to pure scheduling, CLI arguments, terminal replay, and game logic. Add request/WebSocket boundary tests, negative authentication cases, DLP failure tests, HLD save verification, and demo isolation checks. The tenancy `VITEST` branch returns fixed success data, so it cannot exercise actual discovery failures.
- **Reduce startup payload.** The build produces a roughly 1.99 MB main JS chunk and 2.24 MB Rapier chunk before compression. Measure which assets load initially, split infrequently used UI/world features, and consider reduced-motion/low-quality presets. Preserve the existing lazy-loaded panels.
- **Improve operational state.** Move global ALM/Teams/flow state into a repository/environment-scoped backend with explicit persistence and status. `rollbackRelease` resets to a fixture rather than previous release history, and all three ALM stages currently get the same active environment URL. These are acceptable fixture shortcuts only while explicitly simulated.
- **Handle empty and stale async results.** The flow UI ignores an empty result and retains old runs. Cancel or sequence requests when repository selection changes, clear empty results, and surface unavailable states. Apply the same pattern consistently to architecture and tenancy panels.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 32 files passed; 321 tests passed; 1 todo.
- `npm run build`: passed; large-chunk warning described above.
- Targeted terminal-null reproduction: confirmed exception with a fake socket.
- Targeted shell-command construction reproduction: confirmed unsafe command construction with mocked `exec`; no real PAC command executed.
- Targeted partial-diff DLP reproduction: confirmed zero violations for an unsafe authentication change.
- `npm run test:e2e` with isolated demo state and port 4499: all 6 Chromium smoke tests passed.

Real credentials, GitHub operations, agent execution, and production deployment were deliberately outside the verification scope. Existing application changes were preserved.
