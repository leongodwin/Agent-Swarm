# Authentication profile discovery and selection

PAC profile inventory is bounded to 64 KiB. Environment roots must use HTTPS
without credentials, ports, paths, queries or fragments. Profile indices must be
positive safe integers and unique. At most one profile may carry the active marker,
which is recognized only immediately after its index, not in a profile label.

Profile selection re-reads PAC auth list after the command settles. It succeeds
only when the observed active index, environment root and parsed account match
the requested profile's prerequisite observation. Failed, ambiguous or mismatched
confirmation cannot return successful selection. Cache invalidation prevents the
old discovery result from becoming confirmation evidence.

This is profile discovery, not a proof of data-plane access or token validity.
Dataverse WhoAmI, organization identity and executing-provider checks remain
required by delivery gates. Discovery retains stale data for display after a
failed refresh; consumers must still honor its stale/unavailable status.

Synthetic tests cover marker placement, duplicate indices/active rows, unsafe
URLs, oversized output, failed selection confirmation, account/environment drift,
closure and concurrent profile-change admission. A read-only native PAC inventory
on 2026-10-14 parsed three profiles and one active MyDevNet profile. No native
selection, login or tenant mutation occurred. Copilot Studio remains paused.
