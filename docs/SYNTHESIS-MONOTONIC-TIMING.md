# Synthesis monotonic timing

Architecture synthesis now captures a monotonic start before request preparation and uses the remaining five-minute budget for its timeout. Every ownership/publication guard and the final completion boundary rejects an expired, backwards or inconsistent monotonic clock, alongside the existing wall-clock consistency checks. A wall-clock change cannot extend execution authority or certify a late successful job.

Active API snapshots expose the current server monotonic observation without changing persisted jobs. Terminal jobs retain a separate monotonic duration. Stored wall-clock start/end/elapsed values remain for chronology and older-record compatibility; completed records with a recorded monotonic duration at or above five minutes fail validation. Restart retains completed timing observations and their provenance.

Latency statistics use recorded monotonic observations only. Older wall-clock-only completions stay in completion history and its denominator, but do not enter median/p95 timings. Coverage counts make that exclusion visible in the UI. The model-job display prefers the server's monotonic observation and explicitly labels a fallback wall-clock estimate.

Timing covers request preparation, admission, model execution, output validation and architecture artifact publication through the completion boundary. It does not include the subsequent final job-history writer drain or independent architecture/tenant acceptance. Artifact payload timing remains a pre-publication wall-clock estimate; operational latency statistics use terminal job observations. These distinctions do not redefine the broader five-minute objective or certify it achieved.

The later completion-commit improvement also includes the critical completion-state write before public completion; see `SYNTHESIS-COMPLETION-COMMIT.md`. Subsequent cleanup/timing refinement remains separately scoped.

Validation on 14 October 2026:

- Focused synthesis/metrics tests: 34 passed, including expired/backwards monotonic clocks while wall time remains below deadline, completion-boundary expiry, persisted/restarted monotonic timing and exclusion of wall-clock-only statistics.
- Production build and isolated Chromium history/telemetry test passed. The rendered active job preferred its server monotonic observation over a different wall duration; coverage exclusions and failed-summary clearing were checked.
- Whole-backend branch coverage 70.46% (7,147/10,142); unchanged 90.01% gate fails.
- Full suite: 1,938 passed, one TODO.

The clock/provider cases use controlled synthetic callbacks. No new native model benchmark, tenant operation, office task or Copilot Studio action was performed. Workload-wide under-five-minute generation, complete governance, 99.5% all-CI-and-integration completion and the coverage target remain unverified.
