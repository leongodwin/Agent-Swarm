# Tool request safeguards and operational evidence

The office now applies a common request checkpoint to Claude Agent SDK pre-tool hooks and permission callbacks, plus connected CLI PreToolUse hooks. Recognized local connector patterns, anonymous-auth payloads and paused Copilot Studio operations can be denied before dispatch. Invalid/uninspectable requests, unavailable governance and unsaved audit decisions deny execution.

This is a request-local safeguard, **not full tenant DLP enforcement, schema validation or a command sandbox**. A safe-looking shell request can invoke an indirect script with different behavior. Native Read/Glob/Grep remain available for diagnosis; non-artifact documentation remains writable. File edits and patches inspect proposed additions/replacements so removal of a prohibited integration is not blocked merely because the old text contains it. Full resulting-artifact checks and actual tenant policy evaluation remain separate work.

## Runtime and restart behavior

- SDK pre-tool hooks check requests even where acceptEdits would bypass permission prompting. Successful hooks leave normal SDK handling in control; denials override execution. Permission callbacks also check and can produce a second checkpoint for the same tool. Counts therefore describe observed checkpoints, not distinct calls or coverage percentages.
- Claude's unattended mode approves only after the office check and audit succeed. Its pre-tool command bridge returns a denial on unavailable or malformed responses.
- Trusted Codex hooks relay denials rather than discarding the reply. Allowed checks preserve native Codex permission handling. The helper only sends request data to a validated loopback office endpoint and uses explicit deny output plus exit code 2 on transport failure. Hook program crash or timeout outside that handling remains a vendor/runtime limitation; this is not a guarantee that every Codex execution path is gated.
- Retained CLI helpers are upgraded before reopening keeper hooks after restart. Missing sessions, handler failures and keeper wait timeouts produce denial responses for PreToolUse; observational event failures remain nonblocking.
- OpenCode, GitHub Copilot CLI and untrusted hooks are not certified as pre-tool-enforced by this feed. Do not infer enforcement from the presence of an installed CLI or from historical green tests. Strict governed cloud delivery still needs certified runtime/adapters and tenant policy/schema evidence.

Protocol behavior is based on the installed SDK types and [official Codex hook documentation](https://developers.openai.com/codex/hooks), including native permission behavior and blocking output. Version-specific end-to-end runtime certification remains required.

## Audit and user experience

Before replying to a recognized request, the service serializes and atomically saves its outcome, actor/runtime/source, rule version, pause state, timestamp and SHA-256 request hash. It does not retain raw request payloads or diagnostic credentials. Totals survive restart; the latest 100 records are retained. Corrupted state is preserved and blocks checks instead of being replaced by an empty passing history. Audit write failure also prevents approval.

`GET /api/governance/tools` requires the normal office session. The Manager console's **Operations & audit** tab polls it every five seconds, shows genuine counts and the latest decisions, and labels tenant policy verification **Not verified**. An accessible header button opens this view directly. The previous fixed ROI, flow success, safety percentage and “live streaming” figures were removed; zero checkpoints explicitly means no evidence.

Demo and live audit files use separate directories. The current feed covers local safeguards only and cannot prove all-stage governance, zero policy breaches, pipeline reliability or production readiness.

## Verification checkpoint — 13 October 2026

Tests exercise SDK hook installation despite acceptEdits, SDK permission denials, lost/malformed/unavailable transport responses, preservation of native Codex permissions, loopback destination restriction, blocked requests, allowed remediation, changing pause state, audit serialization/restart, corruption preservation and failed audit writes. Helper scripts are executed as real child processes against throwaway local HTTP servers; no tenant mutation or real agent message is used for these tests.

The live office API denied an unknown-session pre-tool request. The rendered dashboard showed genuine empty audit state and Not verified, matching the API. It did not display fabricated success or compliance metrics. Evidence is under `.swarm-reliability/live-tool-governance-2026-10-13.json` and `.swarm-reliability/tool-governance/`.

Microsoft's supported [Get-AdminDlpPolicy](https://learn.microsoft.com/en-us/powershell/module/microsoft.powerapps.administration.powershell/get-admindlppolicy?view=pa-ps-latest) discovery module 2.0.219 was installed. The user completed system-browser authentication and the first reader returned an empty list. This is **unverified**: module source shows its public command does not request `ThrowOnFailure`, then iterates `.value`, which can hide API failures as an empty result. The stricter reader verifies the authenticated tenant and MSAL account, uses the exact module route with `ThrowOnFailure`, and requires a complete response before accepting a policy inventory. Its fresh browser sign-in remains pending. The initial empty list is not evidence of absent policies. No policies, roles, licenses or Copilot publication were changed.

Final local checkpoint: 470 tests passed with one existing TODO; all-backend branches reached 1,806/5,796 (31.15%), so the strict coverage command correctly fails its 90.01% threshold. A built, isolated demo-office API regression passed, including authentication on the new audit endpoint and unknown-session pre-tool denial. Build/typechecking succeeded through that test server's build. These tests do not certify native CLI vendor behavior or tenant compliance.

Next: obtain authenticated policy evidence and validate complete scope/classification/endpoint rules; bind it and expanded Dataverse schema contracts into all lifecycle gates; certify native runtimes and restricted execution paths; replace request-only checks with complete artifact and broker-mediated execution proofs. Keep Copilot Studio paused until explicitly resumed.
