# Declared schema metadata consistency

When AttributeTypeName is present, it must agree with AttributeType. FileType
requires the Virtual base representation; it cannot override an unrelated base
type. Contradictory base or typed-detail responses block comparison in migration
and post-import checks before they can be accepted as declared-column evidence.

Observed lengths and file sizes must be positive integers. Precision must be an
integer within the declared contract's supported range; precision-source values
must be integers from zero through two. Integer bounds must be whole numbers.
Observed min/max ranges cannot be reversed when both bounds are declared.
Malformed values cannot become acceptable merely because migration permits an
additive widening of a valid existing range.

Tests cover conflicting type labels before and after typed metadata reads,
native-style file representation, malformed sizes/precision, fractional Integer
bounds and reversed native ranges. Existing identity, pagination and scope guards
remain in force.

A read-only MyDevNet observation on 2026-10-14 checked 33 selected attributes in
exp_expenselineitem. Eight native base/name combinations passed this shape rule,
including Virtual/FileType and Uniqueidentifier/UniqueidentifierType. Contracts
were not independently approved or tested by this probe. It does not establish
complete schema/security coverage or tenant deployment acceptance. No tenant
mutation occurred; Copilot Studio remains paused.
