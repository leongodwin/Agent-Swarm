# Packaged relationship column validation

The source-package schema comparison now checks a one-to-many relationship's
referenced column against its approved schema contract. Previously it compared
entities, the referencing column and cascade behavior, but omitted the referenced
column. An incorrect approved primary-column name could therefore pass that
bounded comparison.

Native relationship XML identifies the referenced entity rather than explicitly
identifying its referenced primary column. The inspector resolves the column only
when that entity is present in the package and has exactly one attribute whose
explicit source type is `primarykey`. It does not infer names from table names,
accept ordinary `uniqueidentifier` columns as primary keys, or use declarations
as independent source evidence. Missing, external or ambiguous primary-column
metadata remains unavailable. Partial table exports also remain unavailable.

This follows the Dataverse [one-to-many relationship metadata contract](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/onetomanyrelationshipmetadata?view=dataverse-latest)
and the documented [solution XML schema](https://learn.microsoft.com/en-us/dynamics365/customerengagement/on-premises/developer/customize-dev/customization-solutions-file-schema?view=op-9-1).
The existing Expense solution XML also contains explicit `primarykey` attributes;
that local source inspection is not a new tenant export or deployment proof.

Each endpoint and cascade value is parsed independently. A malformed field no
longer prevents extraction of other valid fields. The comparator checks those
known facts even when another fact is incomplete, so uncertainty cannot hide an
independently established mismatch. If neither entity endpoint is identifiable,
the relationship remains unavailable rather than acquiring a guessed contract.

Validation includes actual ZIP/XML fixtures for wrong referenced columns,
missing and ambiguous primary keys, external tables, ordinary GUID columns,
malformed endpoints and cascades. Delivery-governance tests reject a wrong
referenced column at build, test, import, post-deploy, verify and health gates
before policy observation. A declaration repair still does not authorize a run:
complete schema, navigation/hierarchy, effective security and DLP evidence remain
separate requirements.

Verification on 2026-10-14: 90 focused tests passed; the full suite passed 1,956
tests with one TODO; the application build passed. Backend branch coverage was
70.60% (7,191/10,185), so the unchanged 90.01% coverage gate failed. The initial
build caught a duplicate test-fixture property, which was corrected before the
accepted build and final full-suite run. This is not evidence of the 99.5%
completion target across all CI/integration runs or comprehensive tenant policy
acceptance.

Codex remains the default runtime; only Codex, Gemini and OpenCode are permitted.
Copilot Studio remains paused. This change makes no tenant mutations.
