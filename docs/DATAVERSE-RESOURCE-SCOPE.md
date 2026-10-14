# Dataverse resource scope

Flow schema inspection now has an explicit parameter scope for supported current-environment Dataverse operations. Unknown parameters, malformed row/paging options, dynamic row-count settings, expanded metadata scope and read operations carrying write fields remain incomplete. Recognized literal table and column references are retained without parameter values. Documented scalar row-count/paging options remain supported; filters, ordering, expansion, FetchXML, dynamic table/column references and unsupported operations still require independent adapters.

The parameter names are based on [Microsoft's current-environment Dataverse connector reference](https://learn.microsoft.com/en-us/connectors/commondataserviceforapps/). This is a local schema-effect allowlist, not a claim to implement every connector parameter or validate all runtime row values and permissions.

Package inventory now marks an affected flow incomplete when Dataverse schema inspection is unavailable, explicit references overflow their bound, or a legacy Dataverse connector lacks a schema/environment adapter. The package-level incomplete finding is retained. Table-reference resolution also rejects contradictory metadata IDs/logical names/entity-set aliases across distinct lookups; repeated references to the same exact entity set retain the existing per-check cache.

Validation on 14 October 2026:

- Focused inspector/resource/package tests: 52 passed before adding the packaged unknown-parameter fixture.
- Full suite: 1,921 passed, one TODO. Backend branches 70.38% (7,115/10,108); unchanged 90.01% gate fails. Production build passed.
- The MyDevNet Dataverse MCP search/describe tools returned the two Expense table schemas and collection names. A native managed-CLI read pinned to `https://org0efd6060.crm4.dynamics.com` verified the exact Report and Line Item logical/collection mappings with two distinct metadata IDs. No profile selection, interactive sign-in, metadata change or row mutation occurred.
- The first Python probe could not launch the npm PowerShell shim (Windows error 2). The corrected invocation uses the installed official CLI entry point with Python argument-list handling, not a new authentication mechanism. The failed receipt remains retained.

Native evidence covers two selected table identities, not full column/relationship/key contracts, caller/tenant identity, effective security, complete package schemas or DLP. Declared schema observations remain explicitly incomplete. No deployment or Copilot Studio action occurred; the full production objective remains open.
