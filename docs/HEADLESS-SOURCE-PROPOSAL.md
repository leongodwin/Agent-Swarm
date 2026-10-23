# Proposed source observation support

These modules are **not wired into release execution**. They grant no authoring,
mailbox, deployment, private-capture or send authority. Existing releases retain
their existing validation and limits.

`headlessSourceContract.ts` validates an optional single-capsule source dataflow.
It requires a captured 14-day window, explicit initializer dependencies, a bounded
Until loop, and a URI guard before each GET. The conservative continuation profile
admits the exact original query followed by one nonempty skip token. Provider
query reordering or other unsupported encoding fails; compatibility is unverified.
Each successful native output must be validated and appended unchanged. A uniquely
named Compose exposes the complete source capsule after the data-mode branch.

`headlessSourceObservation.ts` is a GET-only primitive. Its caller must provide
independently reviewed admission, fresh identity, deadline and storage guards.
It checks action status, captures the complete capsule once, and correlates
read, validation, append and continuation-update repetition metadata. It returns
private source/index values separately from a fixed metadata receipt. It cannot
execute a trigger, follow a content URL, retry, send or write files.

Repetition metadata and static dataflow do **not** independently compare every
native read repetition's value. Independent QA must explicitly accept this
provenance method. No native Power Automate response or skipped-path compatibility
has been established by the synthetic tests.

The proposed source-only maximum is 1,048,576 bytes. This is a new optional profile
requiring explicit design revision and independent acceptance before use. It does
not alter the existing report capture (256,000 bytes), adapter response (2 MiB),
planning (256 KiB), or task/release deadlines. Complete source exceeding its bound
fails; splitting, trimming and preview substitution are unavailable. Worst-case
Inbox coverage or execution-time fit is not promised.

Outstanding integration includes protected exclusive-file persistence, immutable
source/checker/report bindings, a separately QA-owned semantic checker, preparation
acceptance, and operation-specific staged admission with strict legacy defaults.
Unknown wrappers, secured outputs and unavailable native shapes remain failures.
The approved existing tenant-history policy and all exact-report/single-send gates
remain necessary.

Validation: synthetic source/dataflow/observation tests only. These tests establish
no deployed workflow, native preparation, private mailbox result, accepted report,
email dispatch or Inbox delivery receipt.
