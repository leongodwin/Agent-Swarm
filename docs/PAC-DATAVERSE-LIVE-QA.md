# Authenticated PAC / Dataverse delivery-resumption QA

Follow-up: [tracked ImportJob attribution and authenticated maintenance adoption](TRACKED-IMPORT-ADOPTION-QA.md) records the later explicit-target identity fix and pre-dispatch tracked-import recovery evidence. The observations below remain the earlier PAC checkpoint.

Verified 16 October 2026 against user-approved Development, `https://org68dad46d.crm4.dynamics.com/`, organization `276d6f5c-20f4-46de-a631-825a64953d21`. Authentication was leon@graspai.co.uk; no credentials or token cache contents were collected.

## Scope and tenant changes

The user explicitly authorized new empty `CubeFarmResumeProbe` using existing GraspAI Publisher `exp` (`9850f404-ec92-41d0-afc3-033fa42a218b`). Created solution `e29dbb2b-fbc8-f111-aaaf-7ced8d76eca6` through the Dataverse Python SDK and plugin shared authentication helper. PAC exported the genuine solution. Independently inspected ZIP has exactly solution.xml, customizations.xml and Content_Types; no app, flow, table or other components. Package SHA256: `962f73926c7dc1d52135d9910b74b8e7508a2b8f8c40d2999bed1999038c3a4a`. Two imports updated only this empty solution. The probe is retained for review; no existing solutions were altered or deleted. Global auth profiles were not changed.

## Verified live evidence

The final source rerun also passed: `output/pac-dataverse-live-5683709c111d4e21aeafaa8f5722e083/report.json`. Independent QA rehashed all seven final-run native proofs and confirmed exact attribution and zero-process certification.

- `output/pac-dataverse-live-617711972c3f4f58bc37c39553617884/report.json`: authenticated actual PAC inventory and Dataverse WhoAmI; genuine missing-resource provider code `0x80060888`; successful fresh WhoAmI after rejection; owned PAC caller crash followed by successful PAC retry. Seven command/lease/intent-bound Windows Job Object proofs certify zero inherited active processes and disabled breakaway. These are separate real invocations, not scheduler retry approval.
- `output/pac-import-live-2b65f72d0937452fb547217380ea043c`: actual native PAC import returned success, exact command/run/intent attribution, zero-process proof, normal lease release.
- `output/pac-import-crash-live-33334b45c8e049ad8452418ab59fabc5`: second import caller PID53708 killed only after observing a new actual ImportJob while the caller was alive. Job `a0cf587b-8cd9-4056-9f04-a546ca9c2c00` was absent from baseline, started00:51:28Z after native intent00:51:16.045Z, observed00:51:35.624Z at90.91%, completedon null. Native host subsequently published matching zero-process proof and retained original delivery.lock. The remote operation completed00:51:37Z. Two independent authenticated reads agree on100%, completion timestamp and XML errorcode0/succeeded success. Caller termination does not cancel an accepted cloud operation.

Independent QA inspected actual raw files, hashes, real command dispatches and job chronology; no substituted provider results or synthetic deployment approval were used. Harness metadata binds actual command/run/lease; it is not a normal release produced by the full Agent Swarm delivery pipeline. `deliveryResumed` remains false throughout.

## Findings fixed

1. Always quoting simple Windows arguments broke PAC's parser. Quote only arguments that need quoting; regression covers simple tokens, empty arguments, whitespace, embedded quotes and trailing backslashes.
2. Native nonzero-exit handling dropped provider JSON stdout. Retain bounded provider codes; parse stdout and stderr independently so unrelated stderr does not corrupt JSON parsing. Real-process regressions cover CLI text and JSON with stderr diagnostics.
3. Read-only harness timeout lacked owned-child cleanup. It now kills only its own adapter and records the need to inspect native termination proof.
4. Import harness now requires exact target/arguments, explicit probe name/hash, bounded stable digest checks at dispatch, and XML/archive validation of empty unmanaged probe scope. It uses the cooperating-local-file boundary of the production package check; it does not claim protection against a hostile local account replacing a path between validation and PAC opening it.

## Still blocked / not certified

- No authenticated production HTTP recovery/resume or restarted-office adoption was performed. `dataverse auth who` still targets MyDevNet(default), while the approved Development calls use explicit --environment. Production verifyDataverseIdentity correctly refuses that mismatch. A coordinated owned profile selection/auth setup is required; direct target GET success is not a replacement for the configured production identity contract.
- Production currently records the PAC ImportJob identity after command return. An actual interruption before that durable write cannot be repaired by attaching an observed job ID afterwards. The external observer's real ID above is forensic evidence, not retroactively persisted production history. Durable request/job attribution before interruption needs implementation and end-to-end testing.
- Normal delivery history also includes Git fetch/worktree/custom build commands that remain outside certified native recovery eligibility. Do not broaden these gates on the strength of this bounded import test.
- No live import-provider-error scenario, full office forced-crash restart adoption, automated scheduler retry enforcement or app runtime acceptance is claimed by these artifacts. Provider rejection/recovery here is an actual Dataverse read error; PAC interruption and successful remote completion are separate evidence.

## Validation

Type checking and the final build pass (output/pac-live-final-typecheck.log and output/pac-live-final-build.log). Targeted native/identity suites passed84 tests; independent import refusal tests passed4 cases, and Python package acceptance passed7 subcases. Independent tests include nativeProviderErrorIndependentQa.test.ts, liveNativeImportGuardIndependentQa.test.ts and scripts/test_validate_empty_probe.py. The first full coverage run suffered11 timeout failures while live checks were running; it is not a pass. All three affected suites passed78 tests when repeated with one worker (output/pac-live-timeout-recheck.log). A bounded-worker full repeat is recorded separately in output/pac-live-coverage-bounded.log; only its final result can establish the current full-suite/coverage status.

The bounded-worker full repeat finished successfully: 219 files, 4049 tests passed, 2 skipped and 1 TODO; branch coverage90.06% (12566/13952), above the unchanged90.01% gate; statements93.91%, functions92.69%, lines97.54%. This clears the local full-suite blocker; the live production adoption blockers above remain.
