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

## Consolidated and typed-action authentication

The consolidated delivery check validates one fresh PAC observation alongside
live Dataverse identity and, where used, FlowAgent identity. It waits for every
admitted provider read before returning failure, then rechecks Dataverse identity
after those provider reads. Profiles and PAC output use the same bounded,
unambiguous field parser and HTTPS root validator.

A native read-only consolidated check completed in 34.898s, including acknowledged
FlowAgent cleanup; PAC itself took 31.551s. This is one observation, not an atomic
cross-provider login or proof of a latency percentile. PAC still has a material
latency cost, and its second observation remains deferred as described above.

Typed Dataverse operations authenticate Dataverse twice, without reading an
unrelated PAC profile. Cloud-flow actions additionally require matching FlowAgent
identity; their adapter still verifies flow context and connector bindings.
Typed PAC publication retains consolidated authentication. Opaque post-deploy
commands and solution imports also retain the consolidated check.

Read-only native authentication probes for typed Dataverse and cloud-flow actions
completed in 2.356s and 2.708s respectively, with FlowAgent cleanup acknowledged.
No workflow or flow action was executed. These timings measure authentication,
not deployment or application runtime completion.

Each typed action writes a separate `platform-authentication-<action-id>.json`
receipt with its exact provider scope. These do not overwrite the consolidated
`platform-authentication.json` receipt or imply verification of omitted providers.

Declared schema observations continue to report `complete: false`. Undeclared
schema, effective security, DLP, full package resources and application runtime
acceptance remain separate evidence requirements. Copilot Studio remains paused.
