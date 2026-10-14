# Policy receipt integrity and health evidence

Advanced-policy receipts are revalidated when consumed by lifecycle governance.
Their digest must match the parsed assignment/policy facts. Embedded tenant,
environment and policy identities must agree; counts and identities cannot be
ambiguous. An unavailable receipt cannot retain successful facts or a successful
observation digest. This detects inconsistent observations; the digest is not an
authentication signature or full compliance certificate.

Health governance remains separate from the signed release evidence ledger.
The delivery panel exposes the latest recorded health decision and its referenced
package, declared-schema and environment-policy observations. Expanding the
section reads the metadata; collapsed sections do not issue evidence requests.

`GET /api/delivery/runs/{run}/health-evidence` requires the existing office session.
It reads only the registered current health decision, bounded at 64 KiB, and checks
its phase, source commit, environment and release against the run. A `file` query
downloads only files referenced by that decision from its health directory.
Unknown files, escaping paths, missing artifacts, malformed decisions and changed
run context are denied. Older recorded evidence remains readable with its recorded
timestamp; reading it does not grant new deployment authority.

Background delivery refresh retains the last observed snapshot for the same
project while the next read is pending, preserving open evidence sections. A scope
change or read failure clears that snapshot. Release actions are disabled during
refresh; failed history reads are not displayed as an empty verified history.
Polled read errors appear in their panels without repeated global error toasts.

Local HTTP and file tests check authorization, context, allowlisting, size bounds,
path denial, changed context and preservation of the release evidence ledger.
Chromium testing uses a mock delivery API in an isolated demo office; it checks
on-demand reads, retained inspection during a delayed poll, disabled release
actions and removal of stale facts on read failure. These checks do not establish
live tenant health, complete DLP/schema compliance or a production reliability rate.
