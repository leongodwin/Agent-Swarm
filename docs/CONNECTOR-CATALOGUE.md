# Requested connector catalogue observations

Governed delivery now makes fresh read-only catalogue requests for connector IDs
extracted from an integrity-checked, checksum-bound package. The reader uses the
[documented connector-by-ID API](https://learn.microsoft.com/en-us/rest/api/power-platform/connectivity/connectors/get-connector-by-id)
with both the environment path and matching environment filter, API version
`2024-10-01`, and a fixed Power Platform audience. It never follows response URLs,
requests arbitrary endpoints, signs in, creates connections or grants permissions.

The observer checks the Azure CLI account before and after two matching metadata
passes. It requires exact connector resource IDs, names and types, and records only
the custom-API flag and bounded capability strings. Runtime URLs, descriptions,
unknown fields and raw provider errors are omitted. Ten requested connectors,
two MiB per command and eight MiB accumulated response limits bound work.
Cancellation revokes observation authority while awaiting the issued native read.
Missing, changed, malformed or mismatched facts produce unavailable evidence with
no entries or successful digest.

Every applicable delivery stage binds the receipt to its phase, source commit,
release, target environment, manifest and package digests. Content-addressed files
are added to the release evidence ledger only after publication succeeds and are
linked from current health evidence. Permission failures receive actionable fixed
messages; observer success never authorizes deployment.

## Verification boundary

The documented response does not define an operation catalogue. This adapter keeps
`operationIdsVerified`, comprehensive coverage and compliance false; it does not
infer certified connector status from `isCustomApi: false`. Effective policy modes,
action catalogues, endpoints, exceptions and comprehensive schema/security coverage
remain required. Azure CLI profile checks are not native token-user attestation.

On 14 October 2026 the live MyDevNet request was denied with
`InsufficientDelegatedPermissions`: Microsoft listed missing
`Connectivity.Connectors.Read` / `PowerApps.Apps.Manage` permissions. This does not
establish whether both scopes must be granted; an administrator must select the
supported least-privilege client and scope. The implemented reader
reported delegated-permissions in 3,947 ms after two native commands, retained zero
entries and made no permission changes. No positive native metadata response has
been validated; positive parser/drift cases are synthetic regressions. The installed
Dataverse CLI supports `dataverse|erp` request targets, so no undocumented Power
Platform target was substituted. Copilot Studio remains paused.

The full suite also exposed a terminal initialization race: the recovery timer
could send a snapshot while the initial snapshot callback was still pending.
Initial synchronization now owns the same synchronization state as recovery. A
held-initial-callback regression verifies no premature frame is sent after the
timer fires, followed by one recovered snapshot without discarded data replay.
