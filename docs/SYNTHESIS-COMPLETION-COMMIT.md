# Synthesis completion commit

Validated architecture artifacts now require a guarded completion-state commit before a job can expose `completed`, return its result or release its session slot. The job remains `saving` while that write is pending. Its scope and both deadlines are checked before serialization, immediately before atomic replacement and after the write settles. Public timing is measured after that acknowledgement, so the critical completion write is included.

Cancellation during the write marks the job terminal but retains ownership until the write settles; a replacement synthesis job stays blocked. Expiry or changed project/skill scope denies the commit and completion. A shutdown exception after commit changes the job to failed and removes its result rather than leaving a successful record.

The on-disk completion candidate retains the awaiting-completion marker until the final cleanup/timing refinement is written. A restart encountering that candidate refuses to certify completion and preserves its bytes. The marker covers pending runtime or publication acknowledgement; operator messages now say so. Atomic replacement acknowledgement is not a claim of power-loss-safe disk durability or full transactional isolation from external writers.

Timing now includes the critical completion-state write. It still excludes the subsequent cleanup/timing refinement writer drain and independent QA/tenant acceptance. Older artifacts' pre-publication timing and historical wall-clock-only records remain separately scoped. Workload-wide under-five-minute completion is still unverified.

Validation on 14 October 2026:

- Full suite: 1,944 passed, one TODO. Backend branches 70.49% (7,161/10,158); unchanged 90.01% gate fails. Production build passed.
- Controlled real filesystem writes tested a held completion commit, premature result/admission denial, cancellation ownership, scope drift, deadline expiry, shutdown failure and restart from a candidate awaiting acknowledgement.
- Initial focused regressions failed three assertions tied to the older error point/guard count. A later run failed two error-wording assertions. The semantic checks were corrected and compatible wording retained; failed logs remain available.

Model callbacks in these tests are synthetic; no new native model benchmark, office task, tenant mutation or Copilot Studio work occurred. Complete governance, all-CI-and-integration reliability and the backend coverage target remain open.
