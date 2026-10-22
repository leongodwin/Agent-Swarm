# Native-command and target-lease reconciliation

16 October 2026. This follow-up adds durable native-command observations and guarded target-lease inspection to retained delivery recovery. **Safe retained delivery resumption is still incomplete.** No new endpoint clears leases, replays a deployment or grants QA approval.

## Implemented behavior

Ordinary commands dispatched through the delivery service now write an exclusive, flushed intent before invoking the native runner. Each intent binds a random command ID, exact delivery-lease digest, command digest, working-directory digest, timestamp and optional run ID. Arguments, environment values, output and error text are not copied into the journal. A separate flushed result records returned/rejected status and its intent digest. Revoked ownership between intent publication and dispatch prevents execution and leaves unresolved evidence. Failure to persist an intent prevents execution.

Results always declare `nativeTreeQuiescenceVerified:false`. Root return, taskkill completion and absent owner PIDs are insufficient evidence that all detached descendants have stopped. A missing journal means legacy/missing coverage; it never supplies native termination proof. Journal inspection rejects unsupported entries, ownership mismatches, orphan results, malformed/oversized/nonregular files and claimed termination proof. Its aggregate fingerprint binds the inspected file inventory and contents.

New native observations also fence the existing empty-cloud-history recovery path: any same-lease command intent, including a returned command, or invalid native journal prevents that takeover. Empty history without native journal records keeps the earlier bounded recovery behavior.

Retained cloud audits inspect the configured resource-lease directory, including external/shared lease roots. They validate bounded hashed filenames and exact records. Before taking guards they refuse live, foreign and unlinked owners, so read-only reconciliation cannot interfere with a healthy owner's release. Eligible records are guarded in sorted order, reread byte for byte, and checked again before audit publication. New unrelated acquisitions, record changes and native journal drift invalidate the audit. Original delivery markers, state and target leases remain unchanged.

Temporary contention when acquiring a release guard now permits a later release retry. Observed ownership loss remains permanently latched. Fresh resource acquisition now takes the same `.reaping` guard as release and recovery, including when the lease file is absent. Ownership reads reject nonregular records before following them. The audit does not introduce automatic deployment-target reclamation.

The retained receipt includes `nativeCommands` and `targetLeases`, and explicitly sets `nativeTreeQuiescenceVerified:false` and `resumptionAuthorized:false`. Local owner attribution only identifies a matching PID/run record; it is not proof of approved target binding or termination. No command-result receipt can elevate itself into a tree-termination certificate.

## Independent QA and validation

Independent QA identified and verified fixes for the acquisition guard bypass, the actual `canvas-authoring:` resource prefix, summary-only native drift comparison, and the risk of holding live/foreign owner guards during slow cloud observations. The latter has a regression test proving that a legitimate live owner can still release its lease after audit refusal.

Acceptance tests cover flushed-before-dispatch intent, failed intent sync, revoked ownership, rejected native execution, unchanged-count journal drift, malformed and forged receipts, concurrent fresh acquisition, symbolic-record refusal, exact target preservation, foreign/live owners, matching-token identity drift, extra target acquisition, configured lease roots, cancellation and empty-history native holds. These are isolated local/synthetic checks. The symbolic-file refusal test models `lstat` directly rather than requiring administrator symlink privileges.

Final whole-backend validation passed **209 files, 3,940 tests**, with two platform skips and one TODO. Branch coverage is **90.08% (12,362/13,723)** against the unchanged **90.01%** gate. Command: `npx vitest run --coverage --testTimeout=15000 --maxWorkers=4`. Earlier runs encountered five-second delivery fixture timeouts after adding durable flushes and one existing native-cleanup concurrency failure under higher concurrency; the cleanup suite passed all 44 tests in isolation and the final entire run passed with four workers. Delivery integration fixtures allow bounded 15-second filesystem latency; acceptance assertions and coverage thresholds are unchanged.

Independent reviewer `/root/native_lease_qa` ran 94 focused tests plus the service journal integration during review, then reran **35 tests across five suites** after the final release-contention fix. No remaining finding applies to the implemented audit-only scope. Local final acceptance also passed **47 tests across six suites**. Independent QA does not approve retained delivery resumption or tenant runtime readiness.

Typecheck, production build, package dry-run contents and whitespace checks passed. The existing frontend chunk-size warning remains. Package contents include `dist-server/index.js` and this report; no installation/deployment smoke or authenticated tenant execution is claimed for this follow-up. Evidence: `output/native-reconciliation-coverage.log`, `output/native-reconciliation-build.log`, `output/native-reconciliation-typecheck.log`, `output/native-reconciliation-final-acceptance.log`, `output/native-reconciliation-runtime-cleanup.log`, `output/native-reconciliation-package.json` and `output/native-reconciliation-whitespace.log`. `output/native-reconciliation-source-freeze.json` binds seven production files; hashes matched after the final coverage run.

## Remaining implementation and live evidence

1. Implement a trustworthy native process-tree owner that survives or safely reacts to server death, records descendant termination through an owned OS mechanism, and defines unsupported escape routes. On Windows, Job Objects offer inherited process ownership, but broker-created processes require separate treatment; see Microsoft's [Job Objects documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). The present runner does not implement that certificate.
2. Bind complete native dispatch coverage and exact resource-lease identities to the interrupted delivery epoch. Existing legacy records cannot be retrospectively certified from root PIDs or terminal ImportJob observations.
3. Implement a durable, crash-recoverable lease handoff with a startup hold for every partial handoff failure. Preserve uncertain run checkpoints, retry limits and independent approval boundaries; never blindly replay import or post-deploy commands.
4. Then collect authenticated retained-delivery evidence for native descendant survival/termination, genuine forced crashes during import and post-deploy work, target contention, partial handoff failures, restart/resume and independent runtime QA. No such tenant execution was performed in this follow-up.

These are implementation blockers followed by live verification requirements. Passing local tests is not release acceptance or authenticated delivery-resumption evidence.

See [native process ownership and lease handoff](NATIVE-LEASE-HANDOFF-QA.md) for the Windows proof mechanism, explicit maintenance resumption, crash rollback and remaining authenticated evidence.
