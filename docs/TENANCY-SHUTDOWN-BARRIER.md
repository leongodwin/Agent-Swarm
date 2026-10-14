# Authentication work and the office shutdown barrier

Reload and handoff admission now include current tenancy activity. Previously
they checked agent, architecture and delivery work while an authentication process
or profile command could still be running. The office shutdown coordinator also
called a synchronous tenancy close method that requested termination without
waiting for confirmation.

`TenancyService.activity()` reports `process-local-tenancy-work` with counts for
pending sign-in requests, native authentication exits awaiting confirmation,
tracked PAC commands and profile selection. These counts can overlap; they are
not model session counts, tenant access evidence or a process inventory. Runtime
telemetry displays them alongside server and launcher readiness. Failed runtime
reads remove the previous observed activity and readiness.

Reload checks activity before and after launcher preparation. If authentication
starts during preparation, the reservation is cancelled and the current server
remains running. Handoff also rejects active authentication work. These guards do
not invoke fresh profile discovery or cause an interactive sign-in.

`TenancyService.shutdown()` closes admission immediately and shares one completion
promise. It waits for native authentication exit callbacks, profile selections
and outstanding discovery/verification commands. Cancelled verification results
cannot regain authority. A native stop failure is retained: shutdown waits for
the remaining work, then rejects rather than reporting a clean stop. The existing
office shutdown coordinator now awaits this promise alongside the other service
barriers. Synchronous close remains available as the admission/stop-request step.

These are current-process safeguards. They do not persist native authentication
ownership across office crashes/restarts, prove descendant or authentication
broker exit, serialize external PAC clients, or reconcile uncertain remote
operations. The existing supervisor's forced-exit deadline remains an unclean
failure, not an exit acknowledgement. Durable authentication quarantine and the
full retained-operation recovery rehearsal remain required for broader recovery
acceptance.

Verification includes:

- Controlled service tests for shared and reentrant shutdown, delayed native
  exit, pending profile selection/discovery, cancelled verification and stop
  failure retention.
- Authenticated HTTP tests for all activity categories and authentication that
  begins while a launcher prepares a reload.
- Two owned native Node fixtures that keep their roots alive until explicitly
  released. Shutdown stays pending until their actual close events. These are
  synthetic authentication/profile-read programs, not Microsoft sign-ins.
- Both owned native launcher modes retain maintenance and expose the new
  activity contract. The initial full suite caught their outdated fixtures,
  which lacked tenancy activity; that failed log was preserved, the fixtures
  updated, and both modes retested successfully.
- A Chromium test displays pending authentication activity and removes it after
  a failed observation. Its screenshot was inspected; build/typecheck passed.

Final full-suite verification on 2026-10-14 passed 2,010 tests with one TODO.
Backend branch coverage was 70.94% (7,334/10,338), so the unchanged 90.01% gate
failed. These checks do not establish the 99.5% all-CI/integration clean-run
target or comprehensive tenant acceptance.

No tenant mutation or new Microsoft sign-in is required by these checks. Codex
remains the default; only Codex, Gemini and OpenCode are permitted. Copilot Studio
and office agent/deployment work remain paused as previously requested.
