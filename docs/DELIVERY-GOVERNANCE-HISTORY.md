# Delivery governance history

The delivery panel now provides an on-demand summary for build, test, import, post-deployment, verification and health. Its read-only `/api/delivery/runs/:run/governance-evidence` endpoint selects the latest registered decision per stage, validates the lifecycle result schema and exact run/release/commit/target scope, and checks recorded package digests against the retained run pin. A missing newer file, wrong context or malformed registered name cannot cause fallback to an older clear decision. Unregistered files do not participate. A run changing during observation causes a retryable scope error.

The summary distinguishes recorded clear/blocked/unavailable, not recorded, and evidence unavailable. Timestamps, reasons and recorded package/settings digests are shown. These are historical records, not fresh execution authority or independently authenticated current tenant compliance. The panel continues to run no governance provider or deployment operation merely by opening evidence. Health artifact diagnostics remain available separately.

Native operation statuses are also displayed: intent is unverified, CLI-reported success still needs independent verification, recorded target verification points to its evidence, and unknown outcomes require reconciliation. The existing recovery-required flag is explicit. Neither a CLI message nor opening historical evidence changes an operation's persisted status.

API responses disable caching. The client fetches only when the section opens, scopes the request to its run/evidence identities, and clears stale facts on refresh failure. Registered audit links remain available in the existing evidence list.

Validation on 14 October 2026:

- Focused reader/HTTP checks passed (42 tests before the added malformed-name regression).
- Isolated Chromium synthetic API/WebSocket test passed, including all six stage labels. Visual inspection confirmed historical labels, unknown-operation guidance, missing stages, digests and removal of stale details after read failure.
- Production build passed.
- Full suite: 1,907 passed, one TODO. Backend branches 70.24% (7,069/10,063); unchanged 90.01% gate fails.

These checks do not prove effective DLP, comprehensive Dataverse schema/resource validation, native import acceptance, independent least-privilege tests or the 99.5% target across all CI/integration runs. Copilot Studio remains paused and maintenance drain is preserved.

The current live office has zero release-scoped delivery runs. Positive live historical-record validation therefore remains unavailable; no release or agent task was fabricated to fill that gap.
