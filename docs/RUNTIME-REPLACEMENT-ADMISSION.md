# Preserve runtime ownership on rejected replacement

Runtime policy used to run after retiring the previous CLI on the same terminal.
A request for Claude, Copilot CLI, an unqualified OpenCode model or an Anthropic
model could therefore stop admitted work before being rejected. Requested
provider/model policy is now checked before terminal mutation. The effective
adopted runtime is also checked before retirement.

Reattachment requires the requested provider to match the retained provider and
the terminal to have no active task owner. Mismatched providers and competing
reattachment requests are refused without killing the process, binding a new
terminal handler, sending a prompt or replacing the hook token. Ordinary checked
replacement and same-provider recovery retain their existing cleanup barriers.

Failure-path fixtures verify the original admitted task can still receive an
allowed governance decision after a rejected replacement. Retained idle sessions
continue denying tools without an admitted task. All 38 focused authority and
native cleanup checks passed. The native test uses an owned synthetic Node
process through the real keeper; it is not Microsoft authentication or model
execution evidence.

Full backend verification passed 2,138 tests with one TODO. Branch coverage was
71.34% (7,499/10,511), below the unchanged 90.01% gate. The production build passed.

This change covers synchronous runtime-policy rejection and reattachment
ownership. It does not establish transactional replacement for every asynchronous
model/trust/startup failure or verify full process-family recovery. Those remain
separate reliability requirements. Copilot Studio remains paused; supported
coding providers are Codex (default), Gemini and OpenCode.
