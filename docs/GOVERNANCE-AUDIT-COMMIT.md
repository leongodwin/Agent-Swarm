# Governance authority at audit commit

A clear lifecycle decision is not permission until its audit has been committed
and authority rechecked. The gate measures the whole operation with monotonic
elapsed time, rejects wall-clock rollback, and applies its 60-second budget even
when the timer callback has not run. Decision timestamp freshness and execution
cancellation remain independent checks.

The atomic writer checks authority before each rename. Expiry during temporary
file writing prevents a clear receipt commit. The gate also rechecks after the
write settles, covering expiry or cancellation during rename or file cleanup.
Lost authority is persisted as unavailable and the stage is denied. If an audit
cannot be written, execution remains denied.

Provider timeout/cancellation still retains ownership until the provider settles;
this change does not abandon a native process or release its leases early. It
also does not establish complete tenant DLP, schema inventory or policy evidence.
Those checks remain separately required before a provider can return clear.

Tests inject elapsed-budget loss before the timer fires, wall-clock rollback,
stale timestamp and cancellation during audit commit, and expiry during temporary
file writing. Existing native provider-close ownership checks remain in the suite.
No tenant mutation or Copilot Studio work is needed for these tests.
