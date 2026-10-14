# Identity verification for declared schema reads

Declared-schema discovery executes only the Dataverse CLI. Before and after its
metadata reads, it checks that provider's active profile, data-plane WhoAmI and
RetrieveCurrentOrganization response against the approved account, user ID,
organization ID, tenant ID and environment ID. The three independent reads settle
before a failure is returned. Cancellation discards observations. Duplicate or
missing profile fields and unsafe organization URLs fail the check.

The organization function has one fixed read-only route. It does not add arbitrary
Dataverse actions to the schema observer's request allowlist. Identity responses
are excluded from the declared metadata inventory and remain subject to its total
response byte bound.

PAC and FlowAgent authentication checks remain on operations that use those
providers. The Dataverse-only observation does not certify either provider and
does not create a shared credential cache or relax tenant access policies.

## Native timing evidence, 14 October 2026

Read-only MyDevNet probes using Leon's existing account:

- Before/after Dataverse identity checks around one table metadata read: 6.506s.
- Actual declared-schema observer, one primary-key column contract: 3.822s.
- PAC's complete identity fields arrived after 34.361s; process close at 34.729s.
  The delay precedes output, rather than being process cleanup. The documented
  `env who` alias and JSON output did not remove it.

These probes demonstrate this bounded read path, not a latency percentile or
complete release acceptance. The separate two-pass consolidated PAC candidate
remains on `codex/deployment-recheck` at `08ec358`; it exceeded the 60-second
lifecycle deadline and is not included in this change.

Declared schema observations continue to report `complete: false`. Undeclared
schema, effective security, DLP, full package resources and application runtime
acceptance remain separate evidence requirements. Copilot Studio remains paused.
