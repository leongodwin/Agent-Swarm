# Observed advanced connector constraints

The delivery gate now compares checksum-bound package connectors and operation IDs
with fresh, scope-bound `ConnectorManagement` version `1.0` rule inputs.
[Microsoft documents](https://learn.microsoft.com/en-us/power-platform/admin/programmability-tutorial-manage-advanced-connector-policies)
an `AllowedConnectorList`: absent connectors are denied, `AllAllowed` permits all
connector actions, and `SomeAllowed` restricts actions to `AllowedActions`.

The supported comparison accepts exact full connector resource IDs and
`AllowedConnectionTypesMode: AllAllowed`. Action IDs are case-sensitive. Empty
explicit action lists deny known operations. Duplicate connector/action identities,
unknown rule versions or fields, partial operations, connection-type restrictions
and assignment overrides remain unresolved. Inputs, resources and evaluation work
are bounded; no declared/fabricated action inventory substitutes for extracted
package operations.

## Local enforcement

An observed connector/action conflict blocks local build, test, import,
post-deployment, verification and health admission. A known conflict remains a
denial if classic-policy discovery fails. Changed archive digests are rejected
before comparison. The lifecycle decision records concrete constraint reasons and
links to its policy and package observations.

A `matched` comparison describes only these observed constraints and never grants
release authority. Full governance still returns unavailable unless an existing
denial applies. Effective enforcement mode, certified connector/action catalogue,
nonblockable-connector behavior, connection types, classic endpoints, exceptions,
opaque components and comprehensive schema/security validation remain unproven.
See [Microsoft's ACP limitations and modes](https://learn.microsoft.com/en-us/power-platform/admin/advanced-connector-policies).
In particular, ACP does not cover HTTP/custom/virtual connectors equivalently, and
non-managed environments have limitations on blocking nonblockable connectors.
Local observed-rule conflicts are not proof of Microsoft's runtime enforcement.

## Validation, 14 October 2026

Synthetic tests cover default deny, action restrictions including webhook triggers,
ambiguity, unknown modes, receipt tampering, identity/freshness drift, opacity,
resource bounds and actual package-derived lifecycle integration.

A fresh read-only MyDevNet observation completed in 8,822 ms, returned zero
environment assignments from the supported endpoint, and compared the saved
integrity-checked Expense package's two resources. The result stayed unavailable;
zero assignments did not become policy absence or permission. Azure CLI profile
scope is not native token-user attestation. No policies, permissions, application
data or tenant components were changed. Copilot Studio remains paused.
