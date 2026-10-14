# Preserve policy denials during evidence publication failure

A scope-bound advanced-policy comparison can identify a known forbidden
connector action before its evidence file is written. Previously, a publication
failure cleared that denial and downgraded the result to unavailable. Both
results prevented execution, but delivery teams lost the known policy blocker.
The validated denial now remains blocked, together with the publication warning.
Unbound, stale or invalid observations still cannot establish a policy denial.

Advanced-policy and declared-schema filenames are now returned only after the
atomic write completes. Failed publication does not advertise a receipt file.
Existing files or obstructing directories are preserved. Matching partial policy
facts do not become permission to execute; comprehensive governance remains
required.

Filesystem fault fixtures cover build, test, import, post-deploy, verification
and health. They exercise action denials with successful and failed classic
policy discovery, matched partial advanced observations, and identity-bound
schema observations. All 139 focused checks passed and type checking passed.
Initial fixture attempts failed because the obstruction must use the normalized
observation digest and its parent directory must exist; the attempts are retained
in the task history and do not count as clean runs.

Full backend verification passed 2,103 tests with one TODO. Branch coverage was
71.20% (7,444/10,454), below the unchanged 90.01% gate. The production build passed.

These are local governance/provider-contract checks, not live tenant deployment
or full recovery evidence. Copilot Studio remains paused. Codex is the default,
with Gemini and OpenCode as the other supported providers.
