# Dataverse declared-column contracts — 13 October 2026

Typed `schema-check` actions can now declare additional constraints, which are checked before import and again after deployment. Existing type/required-level contracts remain supported, but they do not become comprehensive schema evidence automatically. No mismatch is repaired through direct metadata mutation.

The optional `constraints` object supports type-specific properties:

| Column types | Constraints |
| --- | --- |
| String, Memo | `maxLength`, `format` |
| Integer | `minValue`, `maxValue`, `format` |
| Decimal | `minValue`, `maxValue`, `precision` |
| Money | `minValue`, `maxValue`, `precision`, `precisionSource` |
| DateTime | `format`, `dateTimeBehavior` |
| Lookup | `targets` |
| Picklist | Numeric `options` |
| File | `maxSizeInKB` |
| All supported types | `access`: create/read/update API-validity flags, secured flag, optional logical/source-type flags |

Invalid type/constraint combinations, reversed numeric bounds, duplicate targets/choices and unknown properties are rejected. Comparisons preserve false and zero values; absent or malformed observations cannot satisfy a declaration. File metadata is normalized from its platform `FileType` indicator.

Example:

```json
{
  "name": "exp_title",
  "type": "String",
  "required": "ApplicationRequired",
  "constraints": {
    "maxLength": 100,
    "format": "Text",
    "access": { "create": true, "read": true, "update": true, "secured": false }
  }
}
```

## Metadata retrieval and migration behavior

The validator first reads base metadata and requires a unique, complete declared-column match. Detailed constraints use the observed MetadataId and documented typed attribute casts; the returned identity must still match. Picklist values use an OptionSet expansion. The adapter rejects continuation markers and bounded/ambiguous inventories rather than treating a partial response as complete. This follows Microsoft's [typed metadata query interface](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api).

Pre-import checks permit additive columns/tables and widening declared lengths, ranges, precision and file limits. Narrowing bounds/precision or removing existing choice values is rejected. Required-level/type, lookup-target, datetime behavior, precision-source and API/security-flag changes require separate review. After import, declared constraints require exact equality; pre-import widening does not waive post-import verification.

These constraints are read-only observations. API-validity flags do **not** establish a person's effective role permissions. Choice labels/defaults, global-choice semantics, relationships/cascades, table ownership/keys, all package attributes, calculated/rollup behavior, opaque code and advanced DLP remain separate work. The overall delivery provider still cannot certify full schema/governance completion.

## Verified scope

The installed Dataverse metadata skill was used for inspection. MyDevNet (`https://org0efd6060.crm4.dynamics.com`) and Leon's identity were checked with WhoAmI plus a read-only user lookup. Native CLI metadata access succeeded using the existing profile without a new interactive sign-in request.

Four live contracts matched the exported Expense definitions and actual typed metadata:

- `exp_title`: ApplicationRequired, length 100, Text format, create/read/update validity and unsecured flag.
- `exp_totalamount`: Decimal range -100,000,000,000 to 100,000,000,000 and precision 2.
- `exp_status`: five expected numeric choice values.
- `exp_approver`: lookup target `systemuser`.

A deliberately incorrect title length of 99 was rejected. Seven read-only API requests were used; no records, metadata or permissions changed. This does not establish full table or runtime application acceptance.

Tests cover type compatibility, false/missing observations, numeric/size migration widening versus narrowing, choice membership, lookup and datetime drift, typed-query paths, changed metadata identity and ambiguous/missing columns. Full suite: **511 passed**, one existing TODO. Full backend branches: **2,276/6,368 (35.74%)**; the unchanged 90.01% gate returned exit code 1. The built-office API regression and build/typechecking passed.

Evidence: `.swarm-reliability/live-column-contracts-2026-10-13.json`, `schema-expensereport-2026-10-13.json`, `column-contracts-coverage-2026-10-13.txt`, `column-contracts-coverage-exit-2026-10-13.txt`, `column-contracts-api-e2e-2026-10-13.txt` and `coverage/backend/coverage-summary.json`.

The production goal remains active. Complete source/target schema coverage, advanced policy evaluation, restricted execution paths, real synthesis timing and sustained CI/integration reliability remain unverified. Copilot Studio remains paused.
