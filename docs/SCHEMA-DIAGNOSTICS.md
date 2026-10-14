# Scoped schema diagnostics

Declared-schema evidence now records the failing stage, a bounded failure category,
elapsed time, native command count, metadata-read count and API response bytes.
Stages distinguish contract admission, initial identity, package resource contracts,
migration compatibility, columns, relationships/keys, final identity and evidence
validation. Failure categories distinguish validation, provider failure,
cancellation and observation limits.

Remediation text is selected from fixed internal messages. Native stderr, raw
exceptions, credentials and provider error payloads are never copied into a failure
reason. Counts describe this observation only: metadata reads count parsed API
responses, native commands include identity reads, and response bytes exclude
authentication-profile text. The enclosing lifecycle still owns cancellation and
provider cleanup.

An unavailable observation cannot retain verified identity, table names or partial
metadata. Diagnostics must agree with observed/unavailable status. Older valid
evidence without diagnostics remains readable.

## Health evidence in the app

Expanding the latest health evidence displays the schema stage, category, duration,
request counts and remediation. The reader verifies the content-addressed schema
file digest and its phase, source commit, release, environment, manifest digest and
freshness relative to the recorded lifecycle decision before surfacing diagnostics.
A missing, modified, malformed or mismatched sidecar displays evidence unavailable;
the scoped lifecycle decision remains readable. Historical observations retain
their own timestamps and do not become fresh evidence by being read again.

The browser regression checks lazy loading, diagnosis rendering, snapshot retention
during refresh and removal of stale diagnosis after a failed read. Backend checks
exercise stage failures, provider-error redaction, cancellation, response limits,
contradictory status, sidecar mutation and cross-release/context mismatches.

This improves operator diagnosis and telemetry. It does not convert declared checks
into comprehensive schema/security/DLP authorization or grant release approval.
Copilot Studio remains paused.
