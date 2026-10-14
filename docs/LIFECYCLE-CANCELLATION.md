# Lifecycle governance cancellation

A lifecycle check owns its outstanding provider work until that work settles.
The 60-second decision deadline revokes execution authority and requests provider
cancellation. It does not establish native process exit or release delivery and
target leases.

Explicit cancellation follows the same rule. A later `clear` result cannot restore
authority. Once the provider settles, the gate persists an unavailable decision
and rejects the stage. Build, import and post-deployment operations cannot continue
from that decision.

The delivery log records cancellation or deadline expiry and that it is waiting
for provider cleanup. That update is persisted and reported through the delivery
change notification. Delivery remains running and shutdown remains pending until
the provider settles; a provider that ignores cancellation can therefore retain
ownership indefinitely. Inspect the actual provider/native handle before any
recovery attempt. Do not treat an observation timeout as cleanup acknowledgement.

Provider implementations must settle only after their owned commands have closed
or their supported asynchronous work has been accounted for. The lifecycle gate
does not turn an arbitrary provider promise into independent native-exit evidence.

Tests cover deadline cancellation, explicit cancellation, late clear results,
reporting failure, an owned native process held through cancellation until its
close acknowledgement, and retention of delivery/target leases during shutdown.
These are local cancellation and ownership checks. Full advanced DLP, complete
schema governance, tenant runtime acceptance and the 99.5% CI target remain
separate verification requirements.

The current tenant observation covers classic standard-policy inventory only and
must not be treated as proof of advanced policy absence. Microsoft documents
[mixed and ACP-only enforcement modes](https://learn.microsoft.com/en-us/power-platform/admin/advanced-connector-policies),
including effective environment policies retained after environment-group changes.
The next governance adapter must discover that effective environment policy and
mode independently; an empty classic policy list cannot substitute for that read.
