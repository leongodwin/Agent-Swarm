# Native process ownership and delivery lease handoff

16 October 2026. Existing changes are preserved. This follow-up implements Windows inherited-process-tree evidence and explicit retained-delivery lease handoff. It does not certify arbitrary external broker activity or a deployed application's correctness.

## Native execution contract

A detached Node broker keeps the supervisor outside the office process's libuv child job. Windows PowerShell cannot start reliably as a detached process here, so the broker starts it normally and forwards control-pipe EOF, then waits for proof publication. This follows the [libuv Windows child-job contract](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c) and is verified by actual journal-owner process death.

New delivery leases create a lease-digest-bound native epoch before any service command can run. Legacy/missing epochs cannot acquire retrospective complete-coverage status. Commands still publish and flush their intents before dispatch; stdout, arguments and environment values are not copied into journal records.

On Windows, ordinary production delivery commands use `nativeTreeHost.ps1`. The host configures a Job Object with kill-on-close and no breakaway flags. `STARTUPINFOEX` supplies `PROC_THREAD_ATTRIBUTE_JOB_LIST`, assigning membership atomically during suspended process creation, and `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`, inheriting only stdout/stderr. The office control pipe is never inherited by the command. The thread resumes only inside the owned job. This requires Windows 10 / Windows Server 2016 or newer; unsupported mechanisms fail before native execution rather than falling back to PID certification.

The host terminates its job on command-root exit, office control-pipe EOF/cancellation, or deadline. It queries the job accounting record until active processes are zero, then flushes and publishes an intent-bound `.tree.json` receipt. Root-return `.result.json` remains diagnostic. A forced host crash closes the job handle and stops descendants but produces no termination certificate, so recovery remains blocked. Office death can leave a root-result missing while the surviving host publishes valid zero-process proof; that proof is independent of root-return reporting.

Microsoft documents inherited process membership and its [external WMI/broker exceptions](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), and the [atomic job list and handle-list contracts](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute). This is process ownership for cooperating configured tools, not protection against a malicious local user who can edit Agent Swarm's state or replace its configured executables.

Recovery eligibility is deliberately narrower than successful supervision. Currently supported command classes are exact read-only Git `rev-parse`/committed-file `show`, fixed Dataverse identity/GET requests with no duplicate flags, and PAC solution list/import commands. Custom build/test scripts, Git worktree hooks, external browser verification and flow adapters cannot be certified broker-free by an inherited job. They retain unsupported native intents and prevent aggregate takeover approval even if an individual job reports zero processes. Non-Windows native execution retains diagnostic-only behavior and cannot use this handoff. Legacy/custom/adaptor histories need additional ownership mechanisms; retrying them does not manufacture proof.

## Explicit resumption and durable handoff

Every retained run must bind the interrupted lease digest, and each operation command digest must match an intent belonging to that same run. A newer epoch cannot retroactively certify legacy or different-owner runs. Run lease bindings are recorded only when new runs are created; existing runs are never retroactively stamped.

Authenticated `POST /api/delivery/recovery/resume` accepts the same strict `{snapshotSha256, targets}` body as the read-only retained audit. The office and delivery must be in maintenance, delivery startup must be unavailable, and authentication ownership must remain clear. It uses the existing bounded read-only production observer for fresh identity and stable terminal ImportJob observations; clients cannot submit successful observation booleans or native receipts.

Handoff requires a freshly published internal audit, an unchanged delivery snapshot, a complete eligible native epoch with matching proof for every intent, and exact guarded target-lease bytes. Global and target filesystem guards remain exclusive with ordinary acquisition. Native epoch contents, target bytes, state and global ownership are checked again before the global lease moves.

A flushed `delivery-handoff.json` plan and a shared-resource `delivery-handoff.pending` fence precede all lease moves. Ordinary global and target acquisition refuse these holds. Exact old leases move to a transaction archive; the global marker moves last. A committed receipt follows the moves, before fences are cleared. The original state remains untouched by the transaction.

Actual process death leaves guards behind. Explicit recovery uses a Windows kernel file-share mutex whose handle is released on process death. Only guard records matching the transaction token and an absent actual guard owner can be retired; legacy/foreign/live/unverifiable guards refuse recovery. The service then rolls back an incomplete transaction by validating every original/archive record before restoring anything, or finishes cleanup of an already committed transaction. Cleanup is idempotent. After rollback it repeats fresh cloud observations before attempting a new handoff. Changed/foreign state or ownership leaves the holds intact.

Successful handoff reinitializes the service in maintenance. A durable `delivery-handoff-maintenance.json` marker keeps that restriction after another restart; an explicit ready-service undrain clears it. Old active runs become blocked/recovery-required through normal initialization. Unknown operation outcomes, import-started checkpoints, retry history, release approvals and independent QA requirements remain intact. No import, hook or verification is blindly replayed, and no deployment-success or release-approval claim is issued.

## Acceptance and independent QA

Tests cover genuine local Windows process supervision, UTF-8 and argument preservation, cancellation, provider exit failure, malformed output, exact epoch binding, command eligibility, snapshot drift, native epoch deletion, target contention, strict HTTP/authentication boundaries, maintenance persistence, interrupted handoff and idempotent cleanup.

Independent QA uses actual forced child-process death at prepared, resource-moved and global-moved handoff stages, followed by stale-guard recovery and byte-exact rollback. Those handoff cloud observations are synthetic fixtures. Separate real native-host tests verify detached-descendant termination after parent EOF and supervisor death. These are genuine local process observations, not authenticated tenant evidence.

Findings fixed include control-pipe inheritance, unchecked native wait/exit errors, the create-before-assignment window, stale pending-plan reads, epoch disappearance during final comparison, rollback cleanup retry failure, missing rollback guard ownership, helper-loss checks and durable maintenance after restart.

Final backend validation passed **217 files and 4,042 tests**, with two platform skips and one TODO. Branch coverage is **90.03% (12,553/13,942)** against the unchanged **90.01%** gate. Command: `npx vitest run --coverage --testTimeout=15000 --maxWorkers=4`. Earlier passing runs exposed branch gaps at 89.89% and 90.00%; additional ownership, denied-inspection, restricted-request, helper and transport failure tests closed the gaps without changing the threshold or excluding production files.

Independent reviewer `/root/native_handoff_qa` reviewed the implementation and its corrections. Recorded independent runs include **24 tests across three owned suites** for forced crashes, attribution and broker behavior; **58 tests across three suites** for helper, native-output and journal boundaries; and **49 tests across two suites** for the final transport/request/inspection cases. These runs overlap and are not summed. Service/HTTP and maintenance acceptance were reviewed and independently exercised as well. No remaining demonstrated finding applies to the supported scope; this is not authenticated tenant or deployed-app approval.

Production build, typecheck, whitespace and package dry-run checks passed. The compiled broker and copied PowerShell host executed a real bounded native command and produced an exact owner-bound zero-process proof. Package contents include both runtime assets and this report. The existing frontend chunk-size warning remains. No package installation or live tenant sign-off is claimed.

Evidence: `output/native-handoff-coverage.log`, `output/native-handoff-build.log`, `output/native-handoff-typecheck.log`, `output/native-handoff-package.json`, `output/native-handoff-package-runtime.log`, `output/native-owner-crash-proof.log`, `output/handoff-service-http.log`, `output/handoff-boundary-tests.log`, `output/native-handoff-error-tests.log`, `output/native-journal-error-tests.log`, `output/native-transport-error-tests.log` and `output/native-handoff-whitespace.log`. All fifteen production hashes in `output/native-handoff-source-freeze.json` matched after the final coverage run.

## Evidence still required and supported limits

- The retained-cloud scope still requires an attributable recorded ImportJob GUID and the supported import checkpoints. A crash before PAC's job identifier is persisted, unsupported post-deploy operations, mixed legacy epochs or missing native coverage remains blocked. Native termination proof cannot invent remote job identity or retroactively certify those histories.
- Authenticated PAC/Dataverse executions under the new host, including genuine provider errors, interruption during import, office/server forced death, helper death, cloud terminality, target contention and actual service adoption through the production HTTP route.
- Independent deployed-app runtime acceptance after resumption. Terminal imports and stopped native processes do not establish deployment success or correct app behavior.
- Additional ownership contracts for arbitrary build/test scripts, Git hooks, service/WMI brokers, browser and flow adapters; current unsupported histories remain blocked by design.
- The implementation validates process crashes, not machine power-loss/storage-failure durability. Cross-volume resource archives can fail closed during rename and need rollback; no cross-volume or distributed-host fencing claim is made. Preparation crashes before a transaction plan/owned guard is durably published retain investigation holds rather than permitting an unsafe takeover.

No live office restart, paid provider run or tenant mutation was performed in this follow-up.
