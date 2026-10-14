# Bounded typed schema reads

Declared-column checks group existing constrained columns by metadata type and
query at most twenty exact metadata IDs per collection. Singleton groups retain
their individual metadata path. The verifier uses the documented typed collection
cast, selected fields and primitive filters described in
[Microsoft's metadata query guidance](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api).
Choice checks expand only option values instead of localized labels and descriptions.

Every base column is validated before typed requests begin. Each returned group
must contain exactly its requested identities, with unique logical names and
metadata IDs. Missing, extra, duplicated, swapped, changed or paginated results
deny verification. An inconsistent collection never triggers an individual-read
fallback. Type, requiredness, declared constraints and migration expansion rules
remain checked independently for each column.

Requests remain sequential, bounded to 4,000 characters, inside the caller's
cancellation/response-size limits and identity checks. No metadata is cached
across lifecycle checks. Missing additive columns remain permissible only during
migration compatibility; final verification requires their presence.

## Read-only MyDevNet comparison, 14 October 2026

The same four existing Expense Notification string columns passed both individual
and grouped checks. Four individual requests took 6,369 ms; one grouped request
took 1,129 ms. A changed metadata-ID control was rejected, with native organization
and user identity verified before and after the experiment. The complete probe
took 17,919 ms and made no tenant mutations.

Contracts in this comparison were synthesized from current metadata; this proves
query compatibility, resolver behavior and this measured request reduction. It
does not constitute independent release approval, full schema/security/DLP
coverage, production latency assurance or the 99.5% completion target.

Local regression cases cover 100-column chunking, response reordering, malformed
or mismatched results, pre-request incompatibility, migration behavior, mixed
types, singleton paths and independent choice membership.
