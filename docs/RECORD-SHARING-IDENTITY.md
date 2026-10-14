# Record-sharing observation boundaries

Before a record share can be applied or certified, observation must return the
approved principal ID and target record ID. A user must also be enabled. IDs are
compared without case sensitivity. Reads select only the required identity fields.

Every returned principal must have an unambiguous systemuser/team identity. A
polymorphic ownerid requires the declared entity type; conflicting declared types,
explicit keys or ownerid values block the observation. Access masks must contain
recognized, unique rights or the standalone None value. Excessive existing rights
remain drift and are never silently reduced or accepted.

Duplicate matching principals, pagination and potentially truncated inventories
block verification. A malformed unrelated principal also blocks the inventory;
the adapter cannot certify absence from an observation it cannot interpret.
Lost mutation responses still reconcile through a fresh read rather than a second
GrantAccess request.

Tests exercise native-style ownerid and explicit-key representations, conflicting
identities, disabled users, wrong records, unknown/duplicate/mixed rights,
incomplete inventories, excessive rights and lost-response recovery.

Read-only MyDevNet checks on 2026-10-14 confirmed WhoAmI, the expense report table's
entity set and primary ID, an existing report ID, the enabled caller identity and
an empty PrincipalAccesses response for that report. No record, role or share was
changed. This confirms those read shapes; it does not prove a live GrantAccess
mutation, a nonempty principal response or least-privilege employee isolation.
Copilot Studio remains paused.
