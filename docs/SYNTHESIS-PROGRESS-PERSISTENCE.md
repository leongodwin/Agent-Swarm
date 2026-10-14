# Bounded synthesis progress persistence

Architecture synthesis now coalesces streamed progress into one outstanding
snapshot request with a dirty marker for the latest state. A blocked disk no longer
queues a complete history write for every callback. Job admission, readiness,
running, saving and final state transitions keep their separate durability barriers.
Progress received after runtime completion acknowledgement is ignored.

Telemetry publication failure closes synthesis admission, fails the active job
with a fixed safe message, requests runtime stop and keeps the auxiliary lease
until completion acknowledgement. The failure and subsequent cleanup state remain
persisted when storage becomes writable. No failure, cancellation or historical
job is removed from metrics.

The controlled filesystem regression holds the first progress write while issuing
1,000 log callbacks, then completes a schema-valid synthetic model result and sends
1,000 late callbacks. It verifies bounded state writes (at most six), retained
latest accepted progress, a completed saved artifact, ignored late output and one
lease release. A separate injected write failure verifies closed admission and
retained runtime ownership until acknowledgement.

These are local synthetic inference/filesystem tests. They demonstrate the backlog
bound and state/cleanup behavior, not native Codex model entitlement, real model
latency, full HLD semantic quality, tenant compliance or the under-five-minute
end-to-end target. The five-minute deadline and independent architecture/tenant
verification requirements remain in force. The live office stays in maintenance
drain; Copilot Studio remains paused.
