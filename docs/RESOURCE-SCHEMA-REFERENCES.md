# Package-derived resource schema references

Package inspection now records explicit table and column references from supported
current-environment Dataverse flow operations. It preserves static `entityName`,
`$select`, `item/<column>` and object-field names without retaining row values.
The [Dataverse connector reference](https://learn.microsoft.com/en-us/connectors/commondataserviceforapps/)
documents the table and selected-column parameters.

Canvas native Dataverse data sources contribute their logical table names.
Package-derived references are passed to fresh target schema discovery; they
cannot be supplied through a delivery API request to override package inspection.

The schema resolver uses `EntityDefinitions` to resolve an exact entity-set name,
validates the result identity and requires exactly one approved table contract.
Every extracted explicit column must belong to that contract. Existing declared
column/structure checks still run, with Dataverse identity checked before and after
the observation. Repeated entity-set references reuse the same metadata lookup
within that check; logical names are never guessed from plural names.

Dataverse rejected the candidate's `$top` metadata query option in a native probe.
The final query uses supported `$select`/`$filter` and bounds the returned response
locally, rejecting missing, duplicate, mismatched or paginated metadata. See
[Microsoft's metadata query guidance](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api).

## Scope and unresolved references

This covers explicit supported references only. Dynamic tables/columns,
cross-environment overrides, query/trigger expressions, implicit full-row reads,
navigation/lookup aliases, legacy connectors and unsupported operations remain
explicit inventory issues. It does not prove full expression dataflow or complete
schema effects. Extraction is bounded at 300 references per flow and 100 explicit
columns per operation; exceeding a bound records an unresolved inventory issue.

Undeclared external dependencies need reviewed schema contracts. A not-yet-created
table cannot be resolved through target metadata before import and needs a separate
independently bound planned-schema mapping; no creation/mapping is inferred here.
Existing full-governance unavailable/denying decisions remain denying.

## Native evidence, 14 October 2026

The verified MyDevNet package supplied notification-flow references. A read-only
probe resolved its entity set, observed seven referenced columns and rejected an
undeclared-column control, with Dataverse identity checked before and after.
It completed in 10.150 seconds. The probe contract was synthesized from observed
metadata, so this is resolver evidence, not independent QA approval, import,
complete application acceptance or a 99.5% reliability measurement.
