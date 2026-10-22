# Tracked ImportJob attribution and authenticated maintenance adoption

Verified 16 October 2026. Existing working-tree changes were preserved. No global CLI profile was selected, replaced or removed; the approved Development URL remains `https://org68dad46d.crm4.dynamics.com/`.

## Changes

- Dataverse identity verification keeps its approved profile account/tenant, explicit WhoAmI and organization/environment checks. If the active profile's default URL differs, it additionally reads the actual target SystemUser and requires the approved ID/domain, enabled state and a delegated account. A different default is no longer confused with the endpoint actually executing the command. Unreadable/mismatched target identities still fail closed.
- New opt-in manifest field `importTransport: "dataverse-tracked"` dispatches the documented Dataverse ImportSolution action using the existing authenticated CLI. PAC has no caller-supplied ImportJobId option. PAC remains the default for compatibility.
- The tracked path preallocates ImportJobId, hashes the approved ZIP, writes and flushes a bounded body file, persists the exact job/request/package/command binding and flushes delivery.json before native dispatch. A recorded intent is never automatically replayed, including on timeout, missing job or provider rejection. The exact body binding is checked again at the dispatch and retained-inspection boundaries.
- Recovery eligibility admits only the exact tracked ImportSolution POST shape, with its body/job/package bindings and native Job Object proof. It does not admit arbitrary Dataverse writes.
- Tracked mode requires explicit targetBinding and platformIdentity so the actual mutation provider is authenticated before import, plus reviewed manual functional-development governance without settings files or PAC publish-changes semantics. Packages are limited to47 MiB to fit the existing64 MiB JSON processing bound. Unsupported production settings/publishing combinations are refused; no option is silently dropped.
- Retained identity and job receipts now use the existing Dataverse GUID contract. Legacy sequential IDs need not contain RFC UUID version bits; malformed GUIDs still fail.
- An opt-in private native failure-output artifact lets the owned live harness retain bounded stdout/stderr for diagnosis after valid tree proof. The raw stdout/stderr artifact is opt-in; the default path retains existing bounded error reporting and provider codes.

## Native contracts checked

- Installed PAC2.11.2 native import usage has no ImportJobId input.
- Installed Dataverse CLI supports api request --environment, --method POST and --body-file.
- [ImportSolution action](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/importsolution) documents caller-supplied ImportJobId; [Microsoft's solution API guide](https://learn.microsoft.com/power-platform/alm/solution-api) documents tracking that exact ID.
- [Microsoft's Web API example](https://learn.microsoft.com/en-us/power-automate/manage-flows-with-code#import-flows) omits ComponentParameters when none are required. Passing an empty abstract-entity collection caused a genuine provider rejection in live testing, so the tracked request omits that unused field.

## Actual authenticated evidence

Root: `output/tracked-import-recovery-aae0cc86df824efc8f2c755bafdc8b79`.

The user-authorized empty CubeFarmResumeProbe package is SHA256 `962f73926c7dc1d52135d9910b74b8e7508a2b8f8c40d2999bed1999038c3a4a`, publisher GraspAI/exp, with no app/table/flow components. Independent QA checked the exact export and package validator.

1. The adapter used production global/target leases, production identity verification, production recordTrackedImportIntent and native journal/Job Object dispatch. Before POST, delivery.json contained job `e016167f-699e-4d8a-ad01-d474be95a0c1`, full body/command hashes, approved package SHA and checkpoint import-started. No retrospective job lookup or state editing was used to establish attribution.
2. Real provider observations found that exact preallocated job in progress, with no completion time while caller PID23296 was alive. The Python coordinator killed only that owned caller. Five exact lease/run/intent-bound Job Object receipts certified zero active inherited processes and disabled breakaway.
3. Two authenticated terminal observations agreed; the provider XML reports errorcode0 and succeeded success. Cloud processing continued after local termination.
4. A fresh isolated integration host used real DeliveryService, createOfficeHttpApp, browser session-cookie authentication and shared tenancy ownership inspection. HTTP resume returned401 without a cookie and200 after obtaining a real /api/session cookie. Recovery performed real target reads, exact ImportJob reconciliation and committed lease handoff. The original lease/state archive hashes match the killed owner and native epoch.
5. Adoption preserved maintenance, blocked phase, import-started checkpoint and recoveryRequired. It did not replay the import, grant release approval or certify deployment. The owned HTTP host closed through its stdin control pipe, releasing only its successor lease.

The local release/plan approval fields are explicitly constructed integration metadata for the user-authorized empty probe. They are not a normal GitHub/HLD delivery release or an independent app QA approval. The host's unused office interfaces are stand-ins; this is the production recovery surface, not a full launched office. Source HEAD alone does not represent the dirty working tree; final evidence manifests also freeze source-file hashes.

## Findings and retries

- Two earlier tracked requests returned0x80040216 (empty abstract ComponentParameters collection) without observable job creation. Their intents remain quarantined in separate output roots; missing jobs did not authorize replay. The supported request was tested as a separate bounded probe attempt with a new durable ID.
- The first authenticated HTTP reconciliation of the successful crash evidence rejected the legacy user GUID. After fixing the schema, recovery was retried against the same unchanged native/cloud history, without another import or attaching a discovered ID.
- A stale readiness artifact in the harness was corrected to require the newly started server PID. Prior HTTP errors and reports remain archived beside the final artifacts.

## Tests and independent QA

A full DeliveryService execution test asserts that the job/command is already in persisted state at actual injected POST dispatch; interruption retains unknown status and import-started and does not run PAC import. Additional acceptance tests cover the body/package/target binding, malformed/changed files, failed durable save, ownership loss, replay refusal, manifest opt-in limits, actual target-account drift, denied reads and legacy GUIDs. Independent QA reviewed the implementation and actual live files and added separate negative tests.

Final validation passed:224 test files,4079 tests passed,2 skipped and1 TODO. Branch coverage is90.03% (12655/14055), above the unchanged90.01% gate. Build/typecheck passed. Evidence: output/tracked-import-final-build.log, output/tracked-import-final-typecheck.log and output/tracked-import-final-coverage.log. Independent QA's21 tests across four separate suites also passed. An earlier full run caught the missing executor-identity requirement while that fix was being added; the completed final run includes the corrected gate and tests.

## Remaining limits

- Normal delivery epochs containing Git fetch/worktree/custom build scripts remain outside certified resumption. This change does not broaden that gate or prove a complete normal-pipeline crash recovery.
- PAC imports still cannot supply a durable ID before dispatch and retain legacy ambiguity. Tracked imports require explicit opt-in; settings/publishing modes remain blocked until equivalent contracts and live evidence exist.
- A missing, running, inconsistent or unobservable cloud job remains unresolved. No automatic replacement/retry is allowed merely because a read returns404.
- Full launcher/real-office forced restart, end-to-end scheduler retry, deployed app runtime/security/functional QA and release sign-off are not established by this empty-solution integration.
- File checks assume cooperating local processes; arbitrary hostile local accounts can bypass the application. No credential material was read, printed or copied by the harness.

## Subsequent normal-service work

The checkpoint above remains historical. [Pinned preparation recovery QA](PINNED-PREPARATION-RECOVERY-QA.md) describes the subsequent explicit artifact workflow; general Git/worktree/custom-script histories remain blocked.
