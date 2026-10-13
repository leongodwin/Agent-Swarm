# Dataverse cascade contract validation

The relationship contract previously accepted every CascadeType value for every action. A local reproducer showed an invalid Delete=NoCascade contract passing pre-import compatibility when the relationship was absent. The validator now rejects that contract before a metadata request, and the shared delivery action schema rejects the same invalid declaration at manifest admission.

Public actions enforce Microsoft's [documented action-specific values](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/configure-entity-relationship-cascading-behavior):

| Action | Accepted contract values |
| --- | --- |
| Delete | Cascade, RemoveLink, Restrict |
| Assign, Share, Unshare, Reparent | NoCascade, Cascade, Active, UserOwned |
| Merge | NoCascade, Cascade |

This is a supported-value check, not a proof that the table supports merging, the complete parental relationship configuration is valid, or effective access is correct. Archive and RollupView remain explicit observed enum comparisons; no action-specific authoring semantics are inferred for them. The [Web API reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/cascadeconfiguration) identifies Archive as internal use. Comprehensive source/target schema and advanced/effective DLP evidence remain required; the production provider still cannot authorize a clear release from these subset checks.

Read-only MyDevNet inspection used the existing CLI authentication profile and confirmed Leon's organization/user/environment through PAC. An EntityDefinitions/Keys observation returned 952 table entries and 242 keys without a continuation marker. Active key values were the text `Active`; the numeric enum definition alone did not justify changing the existing Web API validator. A fresh Expense Report relationship observation showed the Expense Line Item relation uses Delete= Cascade, Assign/Share/Unshare/Reparent= Cascade and Merge= NoCascade. Its observed contract parses under the tightened validator. This is live metadata observation plus local parsing, not independent release approval or tenant runtime acceptance.

The work used the installed Dataverse overview/query/metadata skills. No tenant records, schemas, relationships, permissions or policy settings changed; Copilot Studio remains paused. Native metadata output and the old/new synthetic reproducer are retained locally under ignored `.swarm-reliability/schema-key-live.txt`, `schema-cascade-live.txt` and `cascade-contract-proof.json`. The reproducer records one metadata request with the old code and zero with the corrected code for the same invalid additive contract.

Focused validation: 91 tests passed across table structure, declared schema, package schema and delivery governance. Build/typecheck passed. Full suite: 1,262 passed, one existing TODO across 105 files. Whole-backend branches remain 5,698/8,855 (64.34%), failing the unchanged 90.01% gate. Results are recorded in `.swarm-reliability/cascade-contract-coverage.txt`; the whole-goal coverage and sustained reliability targets remain incomplete.
