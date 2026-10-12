# API verification, deployment adapters and server reload — 12 October 2026

## Implemented behavior

Backend-only releases now have runner-owned Dataverse API verification, separate from browser acceptance. QA approves immutable criteria/assertions; caller and organization are checked repeatedly. Evidence retains assertion outcomes instead of complete response bodies. API-only scope is explicitly functional-development, cannot certify visible apps or production role isolation, and uses an evidence/recovery review without invented visual scores.

The release runner includes bounded connection repair, record sharing and schema gates. Connection repair uses the previous binding and ETag; a lost response cannot cause a blind repeat. Record sharing is limited to a first, explicitly approved direct share of one record to one principal; no security-role grants or existing-share modifications occur. Schema contracts block incompatible declared type/required-level changes before import and validate the resulting metadata after import. Actual schema creation remains in the supported solution pipeline; arbitrary destructive/data-conversion migrations are outside this adapter.

Canvas authoring and deployment share local ownership leases. Participating workers acquire an opaque token before editing and release only after saving/closing Studio. A surviving token can release its persisted local lease after an office restart; another owner cannot be displaced. Remote Microsoft editing locks are not force-cleared.

Copilot Studio pause is persisted in delivery policy, displayed in the delivery panel and enforced before deployment. Known Copilot/PVA-titled assignments and queued repairs are skipped; surviving Copilot work is attached only to stop it after reload. GitHub Copilot remains available as a coding runtime.

## Verification

- Full unit/integration suite: 50 files passed, 448 tests passed, one existing TODO. The final adapter refinements were also checked with focused regression tests.
- TypeScript validation and production build passed. The existing large physics-bundle warning remains.
- Twelve isolated browser/API end-to-end tests passed on port 4499 with disposable demo state, separate from the live office.
- MyDevNet runner-owned API assertions passed for the approved caller, historical approved report/status/total, and preserved Draft boundary fixture. These are reads of existing fixtures, not a fresh approval transaction.
- Live table mapping, schema observation and already-satisfied connection repair passed against CorporateExpenseManagement. No binding was changed and no tenant permission was granted. The schema required level was inspected dynamically for this adapter smoke check; this is not independent approval of a migration.
- Live office HTTP validation confirmed invalid app IDs return 400, competing Canvas ownership returns 409, a token survives/relinquishes ownership after restart, and Copilot pause persists.
- A controlled reload changed server PID from 24892 to 79636; the resulting non-demo process exposed all five new adapter features. Later source refinement reloads retain the same pause. The restored Copilot worker Grace is stopped, while other sessions remain attached.

Evidence:

- `.swarm-reliability/platform-validation/api-only-2026-10-12/independent-api.json`
- `.swarm-reliability/platform-validation/api-only-2026-10-12/adapter-observations.json`
- `.swarm-reliability/platform-validation/server-reload-2026-10-12.json`
- `.swarm-reliability/platform-validation/current-runtime-2026-10-12.json` — final loaded process, target/pause and smoke-lease cleanup.
- `.swarm-reliability/platform-validation/live-office-2026-10-12.png` — live office after reload.
- Reproducible read-only tenant script: `.swarm-reliability/platform-validation/verify-api.ts`

## Boundaries and remaining validation

Connection mutation and record-sharing failure/recovery paths passed deterministic regression tests; they have not been exercised as new tenant mutations in this batch because the existing binding is correct and no new access grant was requested. Run those tenant cases against explicitly approved disposable targets when a real repair/share is needed.

The generic migration adapter does not replace a reviewed data-conversion/backfill procedure or full application recovery rehearsal. Local Canvas ownership cannot clear a remote Studio lock or coordinate external editors who do not use the broker. Canvas file-picker/upload acceptance, separate licensed employee/approver isolation and individual starter tenant proofs remain outside this backend batch and remain incomplete. Copilot Studio publication/conversation tests remain paused.

Changes are local and loaded in the development office at `http://localhost:5317/`; no main-branch submission was performed in this batch. See [delivery contracts and exact manifest fields](DELIVERY.md).
