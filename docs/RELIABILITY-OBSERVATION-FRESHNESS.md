# Reliability observation freshness

GitHub workflow history retains all observed rerun attempts, including earlier
failures. It requires stable repository/account identity and matching inventories
before and after collection. The metric covers attempts of runs created in the
30-day window across workflows and branches, not other CI providers or tenant
integration runs.

The service checks its 50-second observation budget before and after every read
and again before caching. Late completion or clock rollback invalidates the whole
observation, clears partial counts/digests/failures, and returns an unavailable
reason. A rejected observation is not cached. Admitted reads are awaited; this
does not claim to terminate an underlying provider request at the budget boundary.
The default GitHub reader retains its separate per-request timeout.

Successful receipt time and cache age start at completed collection. Impossible
run chronology is rejected. Tests cover late first/final reads, rollback, no cache
reuse after rejection, completion-based freshness and invalid attempt timestamps.

A native read-only check on 2026-10-14 completed in 3.724 seconds for
leongodwin/Agent-Swarm. Its GitHub window contained 8 completed attempts, 7
successful: 87.5%, below 99.5%. This remote history does not verify unpushed local
changes, all integration providers, production acceptance or future reliability.
No GitHub or tenant writes occurred. Copilot Studio remains paused.
