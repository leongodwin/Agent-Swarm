# Reject ambiguous delivery and tenant evidence

Delivery now uses bounded, duplicate-key-rejecting JSON parsing for committed
manifests, issue prerequisites, PAC solution inventory, tenant API responses,
recovery reports, browser identity state, retained target mappings and final
verification reports. Committed architecture parsing uses the same check within
its existing 8 MiB bound. The bounded persistent JSON reader applies the common
check after its existing file-identity, size and strict UTF-8 read checks.

Declared schema observation rejects ambiguous tenant identity, organization and
metadata responses within its existing 8 MiB aggregate allowance. All six stages
discard verified schema facts after such a failure. Generic errors do not echo
the conflicting values. Consumer schemas, identity checks and policy evaluation
remain independently required; duplicate-key rejection does not certify them.

PAC inventory also rejects ambiguity introduced by case-insensitive name/version
normalization. Each row needs one name alias and one version alias with nonempty
string values. Duplicate case-insensitive solution identities are rejected even
when one row contains the requested version. The inventory is bounded to 5,000
rows. Connection banners around the JSON array remain supported.

All 194 focused delivery, architecture, bounded-file and schema tests passed.
Tests cover escaped/literal duplicate keys, all six schema lifecycle phases,
preflight refusal before build/import, identity/recovery refusal before import,
final verification refusal and ambiguous normalized PAC inventory.

Read-only PAC discovery of MyDevNet succeeded using the existing Leon profile
without an authentication change. The actual 27-row inventory uses
`SolutionUniqueName` and `VersionNumber`, one of each per row, matching the
supported normalization. The native response is retained locally as ignored
evidence; this establishes format compatibility, not live deployment/recovery.

Full backend verification passed 2,198 tests with one TODO. Branch coverage was
71.47% (7,544/10,555), below the unchanged 90.01% gate. Type checking, the
production build and the isolated HTTP smoke test passed.

Copilot Studio remains paused. Codex remains default; Gemini/OpenCode are
supported. Comprehensive schema/DLP governance, all-CI reliability, least-
privilege runtime validation and full recovery remain separate requirements.
