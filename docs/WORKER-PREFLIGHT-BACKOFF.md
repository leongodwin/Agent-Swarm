# Worker preflight backoff

Worker capability/authentication preflight failures persist a context-bound retry
schedule using the same bounded policy as delivery preflight: two minutes, then
exponential backoff; six failures hold automatic attempts. The context binds the
executing runtime, effective model, role, project/linked-project roots and targets,
terminal availability and configured admission policy. Cosmetic changes and
changing error text do not reset it.

Automatic scheduling respects the retry schedule across restart. Changed context
can obtain fresh checks without also waiting out the ordinary execution-failure
cooldown. Manual assignment/follow-up is an explicit fresh attempt and is not
blocked by the automatic timer. Successful preflight clears the retry schedule.
Permanent model holds remain separate and cannot be bypassed by a timed retry.

The worker's error message exposes the next automatic time or explains that the
circuit is held until configuration changes or manual retry succeeds. No stale
preflight evidence authorizes workspace preparation or session launch.

Tests cover automatic timing growth, cosmetic edits, explicit repair retry,
restart, changed runtime context and a six-failure circuit with changing error
text. These are controlled lifecycle tests, not a live outage/cross-tenant delivery
or a 99.5% reliability claim. Copilot Studio remains paused.
