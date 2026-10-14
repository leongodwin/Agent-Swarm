# Operation retry ownership

Reconciliation rejects overlapping calls for the same operation on the same
in-memory delivery run before either a second observation or mutation. The first
call retains ownership until its promise settles, including persistence and error
handling. The guard is released in a finally block after success or failure.

A later retry must freshly observe the platform. Persisted intent and unknown
outcomes still prohibit blind mutation; a satisfied postcondition can reconcile
a lost response without repeating its write. Independent operation IDs retain
their own guards.

Tests hold the first observation while a second call attempts entry, verify one
mutation and one operation record, then retry by observation. They also cover
read failure recovery and independent operations while an observation is pending.

The guard is process-local and keyed by the run object. Durable release ownership
and existing delivery exclusivity remain necessary across processes or separately
loaded copies of a run. These tests do not prove a tenant mutation or cross-process
lease protocol. Copilot Studio remains paused.
