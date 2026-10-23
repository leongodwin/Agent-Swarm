# Fixed Outlook folder-metadata probe: review boundary

The business design remains independently rejected. This optional technical
review does not approve that design, its tasks, a deployment, private execution,
an accepted report or an email. Existing findings and their original evidence
remain unchanged. The descriptor in the delivery record requests review only.

The fixed builder permits a manual Button trigger and exactly two Outlook
HttpRequest GET actions: owner Inbox folder counts and one literal invalid
folder-count route. It contains no message routes, mail content, recipient,
send, recurrence, retry controller, arbitrary expression or custom definition.
The second GET follows successful folder-body schema validation. An invalid
folder is an attempted failure path, not a promised HTTP status. Folder counts
are personal metadata retained under the user's existing tenant history policy.
The fixed FlowAgent template marker is authored explicitly for exact readback.
Only the exact existing server-injected authentication reference is normalized.

`connector-probe-contract.json` lives under the project's existing canonical
configuration root. It contains schemaVersion 1, the strict plan and exactly
five evidence controls. The supplied plan's two implementation/configuration
hash fields are syntactically checked but replaced by hashes computed from the
actual installed implementation and current contract/capability configuration.
No supplied code, shell command, URI or definition is executed. Every proposal
also binds the current record, source commit, task hash, assigned owner/reviewer,
target, connection, adapter and same eventual flow/solution contract.

GET `/api/repos/:repo/connector-probe` inspects the proposal. POST to its
`/review` suffix requests the assigned QA actor through the normal host. The
QA-only `delivery_record` action `connector_probe` supports inspect, bounded
hash-bound source/control reads and an explicit five-control review. Review
expires after at most one hour and at the earliest evidence expiry; changes
invalidate its proposal hash. No business record decision is rewritten.

This change deliberately exposes **no execution endpoint**. The fixed runner,
same-resource management setup/readback, protected native output capture,
durable unknown-outcome holds and stopped-state cleanup must be implemented and
independently reviewed before any probe may run. A review of this code cannot
establish those missing capabilities. A future implementation must be included
in the proposal's complete pinned sources and needs fresh independent approval.
No root script, direct tenant API or generic worker authority may substitute.

Limits retained: one host trigger, at most 64 management/capture calls,
256000 bytes per native output, 120 seconds per check, stop new work at 90
seconds, one-hour release bound, no cancellation/replay of unknown operations.
No 24/8/12 scenario, four-real-run, quality, recovery, source/report checker,
native receipt or guarded final-send credit is earned by these synthetic tests.

Primary endpoint contracts are Microsoft Graph Get mailFolder and mailFolder
resource documentation and the Office 365 Outlook connector's Send an HTTP
request operation. They establish supported inputs and folder properties, not
the connector's native response/status/header envelope or a real run result.
