# Health artifact integrity

Health downloads now serve captured, bounded bytes after verifying the registered
artifact's content digest and its typed evidence contract. The route no longer
reopens a previously checked path for streaming. A changed current decision,
unregistered name, unsafe path, missing file, altered bytes or malformed contract
denies the download with a fixed error. Raw filesystem/provider diagnostics are
not returned.

Schema observations and catalogue wrappers must match the phase, source commit,
release, environment and manifest digest of the lifecycle decision. Catalogue
wrappers must also match its package digest. Policy/schema/catalogue timestamps
must have been fresh when the recorded decision was made; viewing old evidence
does not refresh it or authorize deployment. The reader rechecks the captured
decision after reading an artifact and the HTTP route rechecks the current run
before sending the captured bytes.

Package inventory filenames identify the source archive hash, so they cannot serve
as inventory-content hashes. New lifecycle receipts separately record
`packageInventorySha256`, calculated from the published report bytes. Report/archive
identity and completeness flags are checked at download. A missing legacy report
digest prevents its download as verified evidence while leaving valid historical
unavailable/blocked decisions readable. Clear receipts with an inventory pointer
require its content digest. This does not turn partial inventories into compliance.

The binary reader retains raw UTF-8 bytes, including BOMs, for integrity checking;
existing text/JSON reader behavior is preserved. Per-file size and file-change
checks remain enforced. Download requests skip unrelated schema-summary reads.

Regression checks cover exact Unicode/BOM bytes, mutation before and after reads,
decision changes during artifact reads, source/target/package/manifest mismatch,
recorded freshness, registration, digestless legacy reports and authenticated HTTP
download rejection. This is local evidence-integrity verification, not tenant
runtime acceptance, signed provenance against a hostile local administrator,
complete DLP/schema governance or the 99.5% reliability target. Copilot Studio
remains paused.
