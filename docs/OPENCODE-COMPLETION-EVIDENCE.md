# OpenCode completion evidence

OpenCode idle events no longer establish success by returning an arbitrary last assistant reply. The generated plugin requires an observed current user-message identity, a bounded ordered message inventory with distinct identities, exact session and parent identity, a completed assistant timestamp, attached parts belonging to that assistant, and bounded non-empty text. An error-bearing reply is failed even when its text looks successful. Missing or malformed evidence is an unverified failure.

Provider errors are latched before asynchronous notification. The idle notification repeats the failure, so a lost standalone error notification cannot turn it into success. Updating the same user message does not clear the latch. A new user-message identity resets it and invalidates an older in-flight idle observation. Native message reads expire after three seconds and request cancellation; late results cannot publish success. The server requires an explicit outcome in a root-owned completion and preserves structured HTTP 429 fallback eligibility when the failure is recovered through idle evidence.

This follows the [official OpenCode message and error schema](https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/v1/session.ts). It does not add inference, change task assignments, grant platform access, or bypass execution admission.

Validation on 14 October 2026:

- Final focused generated-plugin and CLI authority tests: 64 passed. Cases include lost errors, stale/mismatched replies, incomplete/reversed timestamps, duplicate/unordered inventory, invalid errors, oversized/empty text, changed prompt during observation, stalled reads and missing outcome markers.
- Production build passed.
- Full suite: 1,861 passed, one TODO. Whole-backend branches 69.91% (6,948/9,938); the unchanged 90.01% gate fails.
- An isolated native OpenCode 1.18.35 server created a local metadata-only session and delivered the expected root-session announcement using the final generated-plugin digest `dfc9cc2b4b826e25d8c752fcd221d0a51260014b62ae6454ab2ec39fd13a4f8e`. Final metadata observation took 2,594 ms; termination command succeeded and root exit was observed. No inference was requested and no tenant record changed.
- The first native initialization attempt timed out at 15 seconds and was explicitly stopped. It remains recorded alongside subsequent successful probes; success does not erase the cold-start failure.

Native startup/identity evidence does not prove native provider completion, quota fallback or Microsoft tenant acceptance. The completion/error cases use synthetic native event/API callbacks. Complete provider circuit-breaking, the all-CI-and-integration 99.5% target, comprehensive governance and backend branch coverage above 90% remain open. Copilot Studio stays paused.
