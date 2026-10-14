# Environment rule-assignment discovery

The read-only observer uses Azure CLI's existing authenticated user profile for
Power Platform API requests. It does not create app registrations, copy tokens,
change policies or replace the classic policy reader.

For an approved tenant, account and environment, it reads:

- `GET /governance/ruleBasedPolicies/environments/{environmentId}/assignments`
  with `includeRuleSetCounts=true` and API version `2024-10-01`.
- `GET /governance/ruleBasedPolicies/{policyId}` for each returned assignment.

These are documented by Microsoft's [environment assignment reference](https://learn.microsoft.com/en-us/rest/api/power-platform/governance/rule-based-policies/list-rule-assignments-by-environment-id)
and [policy reference](https://learn.microsoft.com/en-us/rest/api/power-platform/governance/rule-based-policies/get-rule-based-policy-by-id).

The observer checks Azure CLI account identity before and after two agreeing
assignment/policy passes. It checks returned tenant/resource/policy IDs, counts
and duplicate identities. Routes are fixed; undocumented continuations, group
resource assignments, unsupported identities, drift, cancellation and oversized
responses become unavailable observations. No partial facts are retained as a
successful observation. It limits each response to 2 MiB and the overall read to
8 MiB; each assignment response is limited to ten rows.

## Evidence boundaries

The receipt has scope `environment-rule-assignment-inventory`, account scope
`azure-cli-profile`, and always reports `complete: false` and
`complianceVerified: false`. Profile agreement is not atomic authentication or
independent attestation of the API token's executing user.

Assignment reads do not prove effective enforcement mode, connector catalog or
action semantics, classic endpoint restrictions, exemptions or comprehensive
schema. An empty list is recorded as an empty assignment observation, never a
general approval or proof that every policy system is disabled.

Lifecycle governance requests the observation alongside schema and classic-policy
discovery at build, test, import, post-deployment, verification and health stages.
It persists identity/freshness-bound receipts as `advanced-policy-<sha256>.json`.
Delivery evidence indexing includes these and declared-schema receipts alongside
package inventories. Existing denying or unavailable decisions remain denying.

## Native evidence, 14 October 2026

The observer reused Leon's existing Azure CLI account and read MyDevNet's
environment assignment endpoint twice. Both returned an empty list; the complete
observer took 3.254 seconds. No policy or tenant permission changes were made.
Tests exercise assigned-policy details with synthetic API fixtures; the tenant
had no assigned policy to verify that nonempty path live.
