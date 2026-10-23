# Protected source storage primitive

This is an unwired foundation for the source-observation proposal. No release or
worker currently calls it. It grants no private-data, deployment or send authority.

The caller must supply the existing fresh Windows ACL/path admission callback.
The primitive checks canonical paths and regular single-link files, but those
filesystem checks do not independently establish Windows ACLs. The leaf must
match the bound delivery-record ID. The caller's exact record revision/hash,
definition, provider run, mode and nonce remain bound to both retained files.

Each capture creates one source file and one index file exclusively, flushes them,
and rehashes them. The index retains the derived source index, counts, observation
receipt and repetition metadata. Reads revalidate the original source and derived
index/counts. Public receipts contain only fixed metadata and hashes; neither
paths nor email content belong in receipts or errors.

The capsule remains bounded by the proposed source-only 1 MiB profile. Its file
allows at most 4 KiB of fixed binding-envelope overhead. The complete index file
is bounded separately by 1 MiB. These limits require review as part of the new
optional profile; they do not change existing report or adapter limits.

Existing files are never overwritten, reused or automatically deleted. Partial
files remain when a write or authority check fails. Failure grants no success,
retry, reconciliation completion or replay. Every later use must rehash the files
and recheck authority.

Synthetic file tests do not prove Windows ACLs or service-history protections.
Integration still needs admission/deadline guards, an independently owned pinned
semantic checker, preparation and private acceptance, immutable accepted-report
bindings, and the existing final single-send and Inbox-receipt gates.
