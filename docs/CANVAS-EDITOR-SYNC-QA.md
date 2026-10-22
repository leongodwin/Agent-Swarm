# Canvas editor and source sync recovery — 18 October 2026

Existing root changes, showcase commits, untracked authoring work and historical evidence remain preserved. No DLP implementation, policy change, permission grant, app overwrite or deployment activation was performed.

## Outcome

The source-readiness diagnostic and engineering instructions now require the supported saved-app workflow. The live editor remains blocked: authenticated maker navigation launches an empty embedded Studio document, and no saved CloudAsset app has been identified. This investigation does not establish a Microsoft provider outage or its root cause. No source, compile, App checker, export, publication or runtime success is claimed.

Microsoft's [supported external-tool workflow](https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/create-canvas-external-tools) requires an existing saved app in the intended environment, coauthoring enabled and Studio kept open. The prior experimental app-ID-free blank-session path did not establish those prerequisites. The [startup troubleshooting guide](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-apps/sign-in/troubleshooting-startup-issues) describes several possible causes; none was assumed or repaired by weakening browser privacy/security settings.

## Changes and independent QA

`server/canvasSourceSync.ts` validates the production Studio edit URL and matching environment/app/account before native launch. It rejects maker home, player, new/unsaved, token/join-session, duplicate and mismatched targets. It never falls back to experimental app creation.

The diagnostic uses only native `connect` with an explicit app ID, `list_accounts`, and `sync_canvas`. It captures into a fresh isolated directory; existing working source is never passed to synchronization. It verifies nonempty bounded UTF-8 regular source files, App plus another source file, exact hashes, canonical directory/file identities, no links, and account stability. Native empty-sync or catalogue messages cannot become source readiness. It rechecks files and cancellation after acknowledged native cleanup. Source-byte observation does not validate YAML semantics or grant authoring/runtime/deployment approval; it does not independently attest tenant app-ID or effective permissions. Zero data sources is not automatically a failure for a genuinely saved blank app; real source schemas are a separate authoring prerequisite.

`scripts/verify-canvas-source-sync.ts` provides the bounded opt-in native CLI. It discovers required tool names, uses the existing provider authentication caches, withholds raw native error/auth-link text, and acknowledges the owned stdio root's exit. It does not prove full process-tree termination. `shared/delivery.ts` now tells engineering/QA workers to use the saved-app path, retain Studio and working source, and stop rather than repeat unchanged failures. This is a local reference-checkout diagnostic, not a newly registered office tool or a cryptographic approval gate.

Independent QA reproduced a cancellation defect: cancellation during successful cleanup initially left a positive source result. The fix now withholds success after interruption. Independent regressions also cover cleanup-time source mutation, replacement of a directory with identical bytes, and a real CLI subprocess refusing an invalid target before launching a sentinel executable or making a capture directory. Initial failure was retained in QA conversation; the final independent run passed **33 tests** and typecheck. Root's broader focused run passed **92 tests with one existing TODO**, and typecheck. These runs overlap and are not additive.

## Authenticated live observations

- The maker root loads as Leon in MyDevNet (default), exact environment `Default-5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c`. The invented `/e/.../home` route fails; the portal's own root correctly redirects to `/environments/.../home`. Recovery used visible portal navigation.
- The portal's own Create from blank → Responsive route opens `action=app-from-screen-template`, with no saved app ID. `EmbeddedStudio` remains an empty/about:blank document. The browser automation API explicitly refuses raw CDP while resolving that paused document response.
- Opening the exact observed embedded Studio URL directly in the same Edge session displays Studio chrome with disabled/loading controls and permits network diagnostics. This is a diagnostic comparison only: an embedded document without its parent handshake is not a working standalone authoring session. It does not prove the cause of the empty iframe.
- Existing Canvas MCP reports Leon connected and returns a controls catalogue. Its isolated source sync returns **No files returned from server. Nothing written.** `SwarmProjects` schema discovery reports the data source not found in the current session. These are unbound-session observations, not proof the app is empty or that the dedicated SharePoint list is absent. No new experimental MCP connect was attempted.
- Authenticated `pac canvas list --environment https://org0efd6060.crm4.dynamics.com` succeeds as `leon@graspai.co.uk` and lists Product Description and Corporate Expense Management — Validation. No CloudAsset app is visible to that caller in this inventory; this is not a tenant-wide absence assertion. Existing apps were not opened for editing or changed. Output: `output/canvas-editor-live-app-inventory.txt`.
- The actual unsaved portal URL was supplied to the production diagnostic with the real environment/account and no invented app ID. It returns **blocked**, exit 2, before native launch. Output: `output/canvas-source-sync-live-admission.json`. This verifies negative admission only, not authenticated successful source sync.
- The office-local .NET SDK is 10.0.402 and the installed native Canvas MCP package is 1.1.29. The manager shell's system .NET 8 is separate; existing worker code already supplies the private SDK. No SDK/path fix was fabricated.

## Running the supported diagnostic

From the Agent Swarm reference checkout, after the actual dedicated app has been saved and its coauthoring Studio tab is open:

```text
npx tsx scripts/verify-canvas-source-sync.ts --live --studio-url <saved-edit-URL> --environment-id <exact-environment-ID> --app-id <real-saved-app-GUID> --account <approved-UPN> --server <approved-installed-native-MCP-executable> --output-root <existing-canonical-diagnostic-directory>
```

Use the installed vendor executable, not a guessed download or a replacement provider. Keep the source capture for review. No positive result from this diagnostic authorizes compile, publish, resource writes or deployment. Missing native response contracts or a closed/expired Studio session remain blocked.

## Delivery rerun and remaining blockers

The office accepted graceful handoff (HTTP 202); old PID 45288 exited and replacement PID 38924 loaded the updated engineering instructions against the same home and port. Deployment admission at **12:52:05 UTC** returned **HTTP 409 — Real delivery is not enabled**. Record 43 remains unchanged, architecture unreviewed and task approvals empty. There are zero runs/releases. Office paused, zero active sessions and zero owned native PIDs. Evidence: `output/canvas-editor-delivery-rerun.json`, archive `C:/temp/AgentSwarm-CloudAsset-E2E-829bcf65/canvas-editor-delivery-rerun/20261018T125204792354Z/`.

The final independent audit found no additional source, worker-instruction or report findings. It verified the retained negative CLI admission and caller-visible PAC inventory, and the unchanged record/release/run/paused-state evidence. It made no additional tenant or browser calls and did not grant architecture, task or runtime approval.

The immediate live blocker is a working **saved dedicated Canvas app with coauthoring Studio open and authentic nonempty source sync**. The browser automation document-resolution failure needs isolation through a supported working browser session before claiming Studio recovery. No exposed API resolved it in this run. Further live acceptance still needs actual source schemas, zero-error compilation/App checker/export and independently verified runtime. Existing dedicated-channel/flow claim and recovery contracts, trusted native QA adapter/history/denied identity, operation-specific standard-use/effective access, and fresh architecture/task approvals remain unresolved. No repeated architecture/model review was run while these substantive prerequisites stayed unchanged.
