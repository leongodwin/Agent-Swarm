# Pinned preparation and normal-service recovery QA

16 October 2026. Existing workspace changes are preserved. This is a bounded infrastructure recovery route, not a completed Power Platform application release.

## Recovery contract

A release may explicitly select `preparation: {kind: "pinned-artifact-v1", sourceCommit, manifestSha256}`. Its committed manifest declares a canonical base64 ZIP, approved package hash and reviewed file hashes. This route requires the exact commit already in the local repository. It does not fetch or create a Git worktree, and cannot specify executable build, test, verification or post-deployment commands. The existing custom-script route remains available with its existing recovery restrictions.

Raw Git reads use exact bounded `ls-tree` and `cat-file blob` shapes, disable lazy fetching, object replacement, optional locks, filesystem monitoring and protocol/credential helpers, and clear inherited Git overrides. Executable blobs, links, unsafe Windows paths, aliases and changed hashes are rejected. Runner-owned materialization writes exclusive private files and validates the actual ZIP. Source: [Git cat-file](https://git-scm.com/docs/git-cat-file); installed Git 2.55.0.windows.5 was checked for the required native flags.

The journal records a distinct `runner-owned-local-files` receipt. It never represents filesystem work as a Windows process-tree proof. Recovery verifies the current output hashes and requires exactly one preparation receipt bound to the retained run, approved source commit, manifest and private checkout. Missing, changed or mixed arbitrary-command history blocks handoff. Existing history is not discarded or retrospectively upgraded.

An additional explicit `recovery.scope: "empty-solution-only"` exclusion is limited to a functional-development, manually reviewed, tracked import without UI, settings, declared components or post-deployment actions. The actual package must be a bounded, valid three-entry unmanaged ZIP with no root components, dependencies or customizations. The exclusion records `restorationVerified: false`, `deploymentOutcomeVerified: false`, and `tenantMetadataMutation: true`. It is not a data-restoration rehearsal.

Actual target identity observations and independent per-phase governance remain required. Empty-package applicability review does not certify tenant-wide policy, licences, app behavior or security. New applications and nonempty packages retain the substantive recovery and QA requirements.

## Live protocol

The authorized target is Development, `https://org68dad46d.crm4.dynamics.com`. Only the existing GraspAI/exp empty CubeFarmResumeProbe package is permitted, SHA256 `962f73926c7dc1d52135d9910b74b8e7508a2b8f8c40d2999bed1999038c3a4a`. Global CLI profiles are unchanged.

The user selected `leongodwin/Expnese-App2`; actual closed issue #37 supplies the normal-service issue prerequisite. Its closure does not accept the probe or the expense application. A private shallow clone receives an isolated local probe commit, without pushing or modifying the application workspace.

The live harness uses actual `createRelease`, architecture review, approval and `start` APIs. Independent QA must review each fresh release and build/test/import assessment. Immutable implementation snapshots and exact evidence hashes are retained. No release, run, job or decision state is inserted or backdated. A coordinator observes the preallocated exact ImportJob while the owned caller is alive, kills that caller, checks native/local receipts and terminal cloud observations, then exercises authenticated production HTTP reconciliation and lease handoff.

The first attempt, `output/tracked-import-recovery-normal-764ed990a9a04c1b946a8e1abe3f0cf5`, reached independent phase review but its 240-second coordinator deadline expired before import dispatch. It is a failed attempt with its evidence retained. Its approvals are not reused. The coordinator now allows 900 seconds for native preflights and independent reviews; per-phase governance deadlines and actual approval requirements are unchanged.

## Remaining boundaries

Arbitrary Git fetch/worktree/build script histories remain ineligible. This route prepares approved prebuilt artifacts; ZIP checks are not application compilation or runtime tests. A crash during incomplete local preparation remains quarantined, and automatic reuse/retry of a partially materialized checkout is not implemented. Unknown remote jobs are never replayed automatically.

PAC caller-supplied attribution, production settings/publishing, full launcher/real-office restart and application runtime/security acceptance remain separate evidence requirements. The integration HTTP host uses production recovery/session/lease code, with stand-ins for unused office interfaces.

A second preserved attempt, `output/tracked-import-recovery-normal-fef8160cd3c14d219505b97edf554596`, stopped at build governance when the independent decision arrived 46 seconds after assessment publication, beyond its 35-second review window. No import was dispatched. No production deadline or evidence freshness rule was relaxed; subsequent review watches assessments as they appear.

## Verified normal-service crash adoption

Successful evidence root: `output/tracked-import-recovery-normal-6b88a98a67814750ac7cb0650b9b1d44`. The API-created release `dae4e082-51b0-4b48-b2ad-bbd7b8e505d0` pins local probe commit `43ecf17282245ca0ed92c7bc03deb080c5379269`. Independent QA reviewed that release and all three fresh build/test/import assessments against immutable implementation snapshots and current target identity.

Job `0ad26a62-7c8d-465d-a4dc-f2107b309266` was durably persisted before dispatch at 08:51:29.421Z. The provider started it at 08:51:32Z; the coordinator observed it incomplete at 08:51:34.717Z while owned caller PID69396 was alive, then killed that caller. The provider completed at 08:51:46Z and two stable terminal observations report success. There is one attributed POST, with no replay.

All 81 native Windows receipts bind to their exact intents and prove zero active processes with breakaway disabled. One distinct local receipt binds preparation to the approved commit, manifest, checkout and current output hashes. A fresh HTTP host returned401 without session authentication and200 with a real session, reconciled the exact cloud job and archived the exact killed-owner lease/state during committed handoff. The adopted run remains blocked at `import-started`, with `recoveryRequired` and durable maintenance. `deploymentOutcomeVerified` and release approval remain false. Independent QA saved its audit in `independent-qa-audit.json` and found no demonstrated issue in these artifacts.

A third preserved attempt, `output/tracked-import-recovery-normal-fda0b8586c7e44daa5ceed57c2ad992c`, stopped before its first phase assessment because a response failed strict JSON grammar/ambiguity/bounds validation. No import was dispatched. The isolated harness now retains read-only provider response diagnostics; the root cause of that earlier response is not established, and no parser or deadline was relaxed.

## Final automated validation

227 test files passed:4133 passed,2 skipped,1 TODO. Backend branch coverage90.05% (12899/14324) exceeds the unchanged90.01% gate. Build and final typecheck passed. Logs: `output/pinned-preparation-final-coverage.log`, `output/pinned-preparation-build.log`, `output/pinned-preparation-final-typecheck.log`. Independent acceptance covers malicious Git configuration, unsafe source paths, output tampering, mixed arbitrary history, absent and duplicate receipts, wrong commit/manifest/checkout/run, and the positive typed handoff. Empty-package negative tests reject managed/nonempty/wrong-name/extra-content/unsafe-XML packages. Native/provider failures and the failed live attempts are retained rather than converted into successful evidence.
